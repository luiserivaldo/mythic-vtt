import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { QuickFieldSelection, Scene } from '@mythic/shared';
import { useEffect, useMemo, type CSSProperties, type SyntheticEvent } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { selectionStore } from '../tools/selection-store.js';
import type { SelectionActor } from '../tools/selection.js';
import { useJoinEnv } from '../ui/join-context.js';
import {
  DEFAULT_QUICK_FIELDS,
  loadQuickFieldSelection,
  quickFieldPreview,
} from '../ui/quick-fields.js';
import { tokenMenuStore } from '../ui/token-menu-store.js';
import { viewerRole } from '../ui/viewer.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import { selectedTokenId } from './range-readout.js';
import type { RenderScene } from './scene-model.js';
import { previewAnchor, previewName, previewValueColor } from './token-preview.js';

const FIND = (rendered: RenderScene | null, id: string | null) =>
  id === null ? undefined : rendered?.entities.find((entity) => entity.id === id);

/** Fixed pixel sizes: the card is screen-space HTML (CAM-04), so it never scales with the zoom. */
const cardStyle = {
  minWidth: 130,
  padding: '6px 8px',
  borderRadius: 6,
  background: LABEL_BACKGROUND_COLOR,
  color: LABEL_TEXT_COLOR,
  boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
  fontSize: 13,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  // The card is a preview, not a surface: the board behind it stays clickable and hoverable, and
  // only the gear (below) takes pointer events. This has to be on the Html wrapper too (and on the
  // card), or drei's absolutely positioned container swallows hovers over the card's box.
  pointerEvents: 'none',
} as const satisfies CSSProperties;

const headStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'space-between',
} as const satisfies CSSProperties;

const gearStyle = {
  border: 'none',
  background: 'transparent',
  color: LABEL_TEXT_COLOR,
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: '0 2px',
  pointerEvents: 'auto',
} as const satisfies CSSProperties;

const listStyle = { margin: '2px 0 0', padding: 0, listStyle: 'none' } as const;

const rowStyle = {
  display: 'flex',
  gap: 8,
  justifyContent: 'space-between',
} as const satisfies CSSProperties;

const fieldLabelStyle = { opacity: 0.75 } as const satisfies CSSProperties;

/**
 * The canvas container holds this card too, and R3F listens for presses on it, so a press on the
 * gear would read as a board press and clear the selection (PERM-01 view state). A React *capture*
 * handler runs before R3F's bubble listener, so the press is stopped here — which is also why the
 * menu opens from the capture handler rather than from `onClick`.
 */
const stopBoardPress = (event: SyntheticEvent) => {
  event.stopPropagation();
};

/**
 * UI-TOKEN-01 / TOK-01 / TOK-03: selecting one token (a single click) shows a small card near it
 * with the name, the three per-viewer quick fields and a gear that opens the full token menu
 * (UI-TOKEN-02). It reads only the host-filtered entity (PERM-03): a value this viewer may not see
 * arrives as "not shared", never as data, and a name this viewer may not read becomes the neutral
 * stand-in (D35). The card is HTML in the view's up direction from the token, so it follows the
 * token in 2D and in 3D (CAM-04) and stays readable at every zoom. A viewer that may not select
 * (PERM-01) or a multi-selection shows no card.
 */
export function TokenPreviewCard({
  scene,
  rendered,
  mode,
}: {
  scene: Scene | null;
  rendered: RenderScene | null;
  /** The rendered mode, so the anchor follows the token in both views. */
  mode: '2d' | '3d';
}) {
  const invalidate = useThree((state) => state.invalidate);
  const selected = useStore(selectionStore, (state) => state.ids);
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const campaign = useClientStore((state) => state.campaign);
  const joinEnv = useJoinEnv();
  const storage = joinEnv?.storage;
  const viewerId = joinEnv?.identityId;
  // UX-07: which three fields the card shows is a per-viewer setting; a missing context or a
  // broken store falls back to the defaults rather than hiding the card.
  const fields = useMemo<QuickFieldSelection>(
    () =>
      storage && viewerId ? loadQuickFieldSelection(storage, viewerId) : [...DEFAULT_QUICK_FIELDS],
    [storage, viewerId],
  );
  const tokenId = selectedTokenId(scene, selected);
  const shown = FIND(rendered, tokenId);
  const source = tokenId === null ? undefined : scene?.entities[tokenId];
  const seat = seatId === null ? undefined : campaign?.seats[seatId];

  // The scene graph is on demand: a frame right after the selection gives the card its z-index and
  // keeps it in front of the labels while the camera is still.
  useEffect(() => {
    invalidate();
  }, [invalidate, tokenId]);

  if (!scene || !tokenId || !shown?.token || !source?.token) return null;

  const token = shown.token;
  const actor: SelectionActor = isHost
    ? { kind: 'host' }
    : seat
      ? { kind: 'seat', seat }
      : { kind: 'spectator' };
  const name = previewName(
    {
      name: token.name,
      layer: token.entityLayer,
      owners: token.owners,
      perms: token.perms,
      labelVisibility: token.labelVisibility,
    },
    actor,
  );
  const rows = quickFieldPreview(
    source,
    fields,
    viewerRole({ isHost, seatId, campaign }),
    seat?.permissions ?? null,
    scene.grid,
  );

  return (
    <Html
      center
      position={[...previewAnchor(mode, shown.position, shown.sizeCells)]}
      zIndexRange={[9, 0]}
      style={{ transform: 'translate(-50%, -100%)', pointerEvents: 'none' }}
    >
      <section data-testid="token-preview" aria-label={`Token preview: ${name}`} style={cardStyle}>
        <header style={headStyle}>
          <strong data-testid="token-preview-name">{name}</strong>
          <button
            type="button"
            aria-label="Token menu"
            aria-haspopup="menu"
            title="Token menu"
            style={gearStyle}
            onClickCapture={(event) => {
              stopBoardPress(event);
              tokenMenuStore.getState().open(tokenId);
            }}
            onDoubleClickCapture={stopBoardPress}
            onContextMenuCapture={stopBoardPress}
          >
            ⚙
          </button>
        </header>
        <ul style={listStyle}>
          {rows.map((row) => (
            <li key={row.id} data-testid={`token-preview-field-${row.id}`} style={rowStyle}>
              <span style={fieldLabelStyle}>{row.label}</span>
              <span style={{ color: previewValueColor(row.color) }}>{row.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </Html>
  );
}
