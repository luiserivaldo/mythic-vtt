import { useViewedCampaign } from '../store/viewed-campaign.js';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useSyncExternalStore } from 'react';
import { DoubleSide, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { assetUrl } from '../assets/asset-url.js';
import { createTextureCache } from '../assets/texture-cache.js';
import { formatElevation } from '../tools/elevation.js';
import type { SelectionActor } from '../tools/selection.js';
import type { RenderEntity } from './scene-model.js';
import { labelVisible } from './token-labels.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR, SELECTION_COLOR } from './canvas-style.js';

/** Host origin for assets. '' = same origin (dev server proxies `/assets` to the host). */
const ASSET_BASE_URL = '';

const loader = new TextureLoader();
const textures = createTextureCache<Texture>(
  (url) =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        reject,
      );
    }),
  (texture) => {
    texture.dispose();
  },
);

const NONE = { status: 'error' } as const;

function useTexture(url: string | null) {
  const invalidate = useThree((state) => state.invalidate);
  const entry = useSyncExternalStore(
    (listener) => textures.subscribe(listener),
    () => (url ? textures.get(url) : NONE),
    () => NONE,
  );
  useEffect(() => {
    invalidate();
  }, [entry, invalidate]);
  return entry;
}

/**
 * Material for a token: its image when loaded; otherwise the placeholder colour (while loading,
 * on error, or for library assets that have no URL yet).
 */
export function TokenMaterial({
  entity,
  color,
  depth = false,
}: {
  entity: RenderEntity;
  color: string;
  /** 3D standees take part in depth testing; the 2D overlay sprite does not. */
  depth?: boolean;
}) {
  const entry = useTexture(assetUrl(ASSET_BASE_URL, entity.token?.image));
  const map = entry.status === 'ready' ? entry.texture : null;
  return (
    <meshBasicMaterial
      key={map ? 'textured' : 'flat'}
      color={map ? '#ffffff' : color}
      {...(map ? { map } : {})}
      transparent={map !== null}
      side={DoubleSide}
      depthTest={depth}
      depthWrite={depth && map === null}
    />
  );
}

/** Selection highlight that keeps a textured token visible (the flat fill is only a placeholder). */
export function SelectionRing({ size }: { size: number }) {
  const half = size / 2;
  return (
    // Not pickable: it must never intercept clicks meant for the token mesh.
    <mesh raycast={() => null} position={[0, 0, 0.001]}>
      <ringGeometry args={[half * 0.94, half, 4, 1, Math.PI / 4, Math.PI * 2]} />
      <meshBasicMaterial
        color={SELECTION_COLOR}
        side={DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * TOK-04 / CAM-04: an HTML label projected to the screen, so it is always upright and faces the
 * camera; never world-space text. Rendered only if this viewer may see it.
 */
export function TokenLabel({
  entity,
  actor,
  anchor,
}: {
  entity: RenderEntity;
  actor: SelectionActor;
  /** Label position relative to the token; defaults to just below the 2D footprint. */
  anchor?: readonly [number, number, number];
}) {
  const token = entity.token;
  if (!token) return null;
  const shown = labelVisible(
    {
      name: token.name,
      layer: token.entityLayer,
      owners: token.owners,
      perms: token.perms,
      labelVisibility: token.labelVisibility,
    },
    actor,
  );
  if (!shown) return null;
  return (
    <Html
      center
      position={anchor ? [...anchor] : [0, -entity.sizeCells / 2 - 0.2, 0]}
      zIndexRange={[5, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        data-testid="token-label"
        style={{
          padding: '1px 6px',
          borderRadius: 4,
          background: LABEL_BACKGROUND_COLOR,
          color: LABEL_TEXT_COLOR,
          fontSize: 12,
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {token.name}
      </div>
    </Html>
  );
}

/**
 * TOK-03: 2D elevation badge ("+10 ft") as an HTML overlay, never world-space text. Shown only
 * above ground and only where the viewer could see the token's label rules (same visibility
 * check, ignoring the name and label mode).
 */
export function ElevationBadge({ entity, actor }: { entity: RenderEntity; actor: SelectionActor }) {
  const token = entity.token;
  const campaign = useViewedCampaign();
  const grid = campaign?.activeSceneId ? campaign.scenes[campaign.activeSceneId]?.grid : undefined;
  if (!token || !grid) return null;
  const visible = labelVisible(
    {
      name: '-',
      layer: token.entityLayer,
      owners: token.owners,
      perms: token.perms,
      labelVisibility: 'all',
    },
    actor,
  );
  const text = visible ? formatElevation(entity.position[1], grid) : null;
  if (text === null) return null;
  return (
    <Html
      center
      position={[0, entity.sizeCells / 2 + 0.2, 0]}
      zIndexRange={[5, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        data-testid="elevation-badge"
        style={{
          padding: '1px 6px',
          borderRadius: 4,
          background: 'rgba(60,40,10,0.85)',
          color: '#ffe066',
          fontSize: 12,
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {text}
      </div>
    </Html>
  );
}
