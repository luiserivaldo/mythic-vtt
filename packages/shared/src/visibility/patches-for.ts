import type { Patch } from 'immer';
import type { Campaign } from '../schema/index.js';
import type { Audience } from './audience.js';
import { diffPatches } from './diff.js';
import { viewEntity, visibleTo } from './visible-to.js';

// Paths that carry nothing an audience may not see, so raw patches can be forwarded unchanged.
// Default-deny: any path not listed here (including fields added later) takes the diff fallback.
const SAFE_ROOT_KEYS = new Set([
  'id',
  'name',
  'schemaVersion',
  'settings',
  'seats',
  'activeSceneId',
]);
const SAFE_SCENE_KEYS = new Set(['name', 'grid', 'environment', 'layers']);

/** Reference implementation: diff the audience's filtered before/after views. O(scene size). */
export function diffPatchesFor(audience: Audience, before: Campaign, after: Campaign): Patch[] {
  return diffPatches(visibleTo(audience, before), visibleTo(audience, after));
}

function prefixed(path: Patch['path'], patches: Patch[]): Patch[] {
  return patches.map((p) => ({ ...p, path: [...path, ...p.path] }));
}

/**
 * Per-audience patches for one reduced action (pipeline steps 7-8, TECHNICAL.md §4.2).
 *
 * G1 (D21): entity-scoped raw patches are translated per touched entity (cost proportional to the
 * patch, ~0.04 ms vs ~16 ms for full diffing at 2000 entities x 11 audiences); anything else
 * falls back to diffing. Raw patches are never forwarded for entities: the audience's *view* of
 * the entity decides between add, remove and field-level patches, so a hidden entity cannot leak,
 * including layer moves in either direction.
 */
export function patchesFor(
  audience: Audience,
  before: Campaign,
  after: Campaign,
  raw?: readonly Patch[],
): Patch[] {
  if (audience.kind === 'host') return raw ? [...raw] : diffPatches(before, after);
  if (!raw) return diffPatchesFor(audience, before, after);

  const passthrough: Patch[] = [];
  const touched = new Map<string, [string, string]>();
  for (const p of raw) {
    const [root, sceneId, key, entityId] = p.path;
    if (typeof root === 'string' && SAFE_ROOT_KEYS.has(root)) {
      passthrough.push(p);
    } else if (
      root === 'scenes' &&
      typeof sceneId === 'string' &&
      typeof key === 'string' &&
      SAFE_SCENE_KEYS.has(key)
    ) {
      passthrough.push(p);
    } else if (
      root === 'scenes' &&
      typeof sceneId === 'string' &&
      key === 'entities' &&
      typeof entityId === 'string'
    ) {
      touched.set(`${sceneId}/${entityId}`, [sceneId, entityId]);
    } else {
      return diffPatchesFor(audience, before, after);
    }
  }

  const out = passthrough;
  for (const [sceneId, entityId] of touched.values()) {
    const b = before.scenes[sceneId]?.entities[entityId];
    const a = after.scenes[sceneId]?.entities[entityId];
    const vb = b ? viewEntity(audience, b) : null;
    const va = a ? viewEntity(audience, a) : null;
    const path = ['scenes', sceneId, 'entities', entityId];
    if (vb && va) out.push(...prefixed(path, diffPatches(vb, va)));
    else if (vb) out.push({ op: 'remove', path });
    else if (va) out.push({ op: 'add', path, value: va });
  }
  return out;
}
