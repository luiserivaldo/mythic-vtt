import { Html } from '@react-three/drei';
import type { SelectionActor } from '../tools/selection.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import type { RenderEntity } from './scene-model.js';
import { markerStrip, markerText, markerTitle } from './status-markers.js';
import { labelState } from './token-labels.js';

/**
 * TOK-06 / CAM-04: the conditions and custom markers carried by a token, as a small HTML strip.
 * Screen-projected, so it is always upright, faces the camera and keeps the same readable size at
 * every zoom; never world-space text. Draws nothing when the token has no markers, so an unmarked
 * table pays no DOM cost, and at most MAX_VISIBLE_MARKERS chips (render budget) plus a summary.
 */
export function TokenStatusMarkers({
  entity,
  actor,
  anchor,
}: {
  entity: RenderEntity;
  actor: SelectionActor;
  /** Strip position relative to the token; the 2D and 3D call sites place it per view. */
  anchor: readonly [number, number, number];
}) {
  const token = entity.token;
  const markers = token?.statusMarkers;
  if (!token || !markers?.length) return null;
  // TOK-06 uses exactly the label audience. The host already strips markers this audience may not
  // read (PERM-03); re-checking here means a marker can never outlive that rule locally.
  const readable =
    labelState(
      {
        name: token.name,
        layer: token.entityLayer,
        owners: token.owners,
        perms: token.perms,
        labelVisibility: token.labelVisibility,
      },
      actor,
    ) === 'visible';
  if (!readable) return null;
  const strip = markerStrip(markers);
  return (
    <Html center position={[...anchor]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div
        data-testid="token-status-markers"
        role="img"
        aria-label={strip.shown.map(markerTitle).join(', ')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '1px 6px',
          borderRadius: 4,
          background: LABEL_BACKGROUND_COLOR,
          color: LABEL_TEXT_COLOR,
          fontSize: 12,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {strip.shown.map((marker, index) => (
          <span key={index} data-testid="status-marker" title={markerTitle(marker)}>
            {markerText(marker)}
          </span>
        ))}
        {strip.overflow > 0 && (
          <span data-testid="status-marker-overflow" title={`${String(strip.overflow)} more`}>
            {`+${String(strip.overflow)}`}
          </span>
        )}
      </div>
    </Html>
  );
}
