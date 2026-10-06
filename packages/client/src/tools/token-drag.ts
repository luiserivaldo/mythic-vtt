import { entityExtents, handleLayout, hitHandle, HANDLE_HIT_PX } from './transform-gizmo.js';
import {
  yawFromQuaternion,
  canPerform,
  clampToBounds,
  dropElevation,
  resolveSceneBounds,
  snapToGrid,
  walkableFromEntity,
  type Actor,
  type Campaign,
  type Entity,
  type Scene,
  type Vec3,
} from '@mythic/shared';
import { DRAG_THRESHOLD_PX } from '../render/camera-2d.js';
import type { RenderScene } from '../render/scene-model.js';
import type { LocalDrag, RemotePreview } from './token-drag-store.js';

export function dragStarted(
  start: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_THRESHOLD_PX;
}

export function movableToken(
  campaign: Campaign | null,
  actor: Actor | null,
  scene: Scene | null,
  entityId: string,
): Entity | null {
  const entity = scene?.entities[entityId];
  if (!campaign || !actor || !scene || !entity?.token) return null;
  return canPerform(campaign, actor, 'token.move', {
    sceneId: scene.id,
    entityId,
    to: entity.transform.position,
  })
    ? entity
    : null;
}

/** TOK-02: snap the footprint centre, clamp its whole footprint, then take exact surface height (D25). */
export function tokenDrop(scene: Scene, entity: Entity, raw: Vec3): Vec3 {
  const footprint = Math.max(1, Math.round(entity.token?.sizeCells ?? 1));
  const snapped =
    scene.grid.snap && scene.grid.type === 'square'
      ? snapToGrid(raw, scene.grid, { footprint })
      : raw;
  const bounds = resolveSceneBounds(scene);
  const half = footprint / 2;
  const centre = clampToBounds(
    {
      width: Math.max(0, bounds.width - footprint),
      height: Math.max(0, bounds.height - footprint),
    },
    { x: snapped.x - half, z: snapped.z - half },
  );
  const x = centre.x + half;
  const z = centre.z + half;
  const walkables = Object.values(scene.entities).flatMap((candidate) => {
    const surface = walkableFromEntity(candidate);
    return surface ? [surface] : [];
  });
  return { x, y: dropElevation({ x, y: raw.y, z }, walkables), z };
}

/** Minimum gap between ephemeral previews (M1-07 budget keeps this well under the rate limit). */
export const PREVIEW_INTERVAL_MS = 50;
/** A remote ghost with no fresh preview for this long is dropped (the schema has no "end" message). */
export const GHOST_TTL_MS = 1500;

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/** Where a ray meets the horizontal plane at height `y`; null when parallel or behind the origin. */
export function intersectPlaneY(ray: Ray, y: number): Vec3 | null {
  if (Math.abs(ray.direction.y) < 1e-9) return null;
  const t = (y - ray.origin.y) / ray.direction.y;
  if (!(t > 0)) return null;
  return { x: ray.origin.x + ray.direction.x * t, y, z: ray.origin.z + ray.direction.z * t };
}

/**
 * Pointer to ground point, following walkable surfaces. After the first hit the token's drop
 * height is known, so intersect again at that height to cancel perspective parallax (3D).
 */
export function groundPoint(ray: Ray, startY: number, scene: Scene, entity: Entity): Vec3 | null {
  const first = intersectPlaneY(ray, startY);
  if (!first) return null;
  const dropped = tokenDrop(scene, entity, first);
  const second = intersectPlaneY(ray, dropped.y);
  return second ?? first;
}

/** The dragged position: the pointer's ground point shifted by the grab offset, then snapped (TOK-02). */
export function previewPosition(
  scene: Scene,
  entity: Entity,
  ground: Vec3,
  grab: { x: number; z: number },
): Vec3 {
  return tokenDrop(scene, entity, {
    x: ground.x - grab.x,
    y: entity.transform.position.y,
    z: ground.z - grab.z,
  });
}

export function samePosition(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.z - b.z) < 1e-9;
}

/** Render-only: show the dragged token at its preview position. Stored state is untouched. */
export function withLocalDrag(
  rendered: RenderScene | null,
  local: LocalDrag | null,
): RenderScene | null {
  if (!rendered || !local || local.sceneId !== rendered.id) return rendered;
  if (!rendered.entities.some((e) => e.id === local.entityId)) return rendered;
  return {
    ...rendered,
    entities: rendered.entities.map((e) =>
      e.id === local.entityId
        ? { ...e, position: [local.to.x, local.to.y, local.to.z] as const }
        : e,
    ),
  };
}

export interface Ghost {
  key: string;
  entityId: string;
  to: Vec3;
  sizeCells: number;
}

/** Remote previews worth drawing: this scene, entity still present, not already where it landed. */
export function visibleGhosts(
  remote: Readonly<Record<string, RemotePreview>>,
  scene: Scene | null,
  now: number,
): Ghost[] {
  if (!scene) return [];
  const ghosts: Ghost[] = [];
  for (const [key, preview] of Object.entries(remote)) {
    const entity = scene.entities[preview.entityId];
    if (preview.sceneId !== scene.id || !entity?.token) continue;
    if (now - preview.at >= GHOST_TTL_MS || samePosition(entity.transform.position, preview.to))
      continue;
    ghosts.push({
      key,
      entityId: entity.id,
      to: preview.to,
      sizeCells: Math.max(1, entity.token.sizeCells),
    });
  }
  return ghosts;
}

/** Throttle: send when enough time passed, or immediately for the first/last position. */
export function shouldSendPreview(lastAt: number | null, now: number, force: boolean): boolean {
  return force || lastAt === null || now - lastAt >= PREVIEW_INTERVAL_MS;
}

/**
 * True when a press lands on a 2D gizmo rotate/scale handle, which keeps that press (M1-20). The
 * gizmo's move handle sits on the token body, where a drag is token drag (`token.move`).
 */
export function pressOnGizmoHandle(
  entity: Entity,
  point: { x: number; z: number },
  zoom: number,
): boolean {
  const extents = entityExtents(entity);
  const half = Math.max(extents.width, extents.depth) / 2;
  const layout = handleLayout(
    { x: entity.transform.position.x, z: entity.transform.position.z },
    yawFromQuaternion(entity.transform.rotation),
    half,
    1 / zoom,
  );
  const kind = hitHandle(point, layout, HANDLE_HIT_PX / zoom);
  return kind === 'rotate' || kind === 'scale';
}
