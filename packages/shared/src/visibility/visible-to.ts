import type { Campaign, Entity, Prefab, Scene, Seat } from '../schema/index.js';
import { audienceKey, type Audience } from './audience.js';

// PERM-03: filtering happens on the host before serialization. Anything an audience may not see
// must be absent from the returned value, not merely flagged.
//
// Results are memoised per (input object, audience). Immer shares unchanged subtrees between
// states, so unchanged entities/scenes yield reference-equal views and `diffPatches` can skip them.

type Cache<T> = WeakMap<object, Map<string, T>>;
const entityCache: Cache<Entity | null> = new WeakMap();
const sceneCache: Cache<Scene> = new WeakMap();
const campaignCache: Cache<Campaign> = new WeakMap();

function memo<T>(cache: Cache<T>, input: object, key: string, compute: () => T): T {
  let byAudience = cache.get(input);
  if (!byAudience) {
    byAudience = new Map();
    cache.set(input, byAudience);
  }
  if (byAudience.has(key)) return byAudience.get(key) as T;
  const value = compute();
  byAudience.set(key, value);
  return value;
}

function ownsEntity(audience: Audience, entity: Entity): boolean {
  return audience.kind === 'seat' && entity.owners.includes(audience.seatId);
}

function viewKey(audience: Audience, seat?: Seat): string {
  const role = seat?.role === 'codm' ? 'codm' : 'player';
  return `${audienceKey(audience)}:view=${seat?.permissions.view === false ? 'off' : 'on'}:${role}`;
}

/** The audience's view of one entity, or null if it must not be sent at all. */
export function viewEntity(audience: Audience, entity: Entity, seat?: Seat): Entity | null {
  if (audience.kind === 'host') return entity;
  const key = viewKey(audience, seat);
  return memo(entityCache, entity, key, () => {
    const owner = ownsEntity(audience, entity);
    // LAY-04 + D32: the DM layer is visible to the host and co-DM seats only, never to players
    // (not even owners of an entity moved onto it) or spectators.
    if (entity.layer === 'dm' && !(audience.kind === 'seat' && seat?.role === 'codm')) return null;
    // PERM-02: the seat-level toggle is the campaign-wide gate for entity visibility.
    if (audience.kind === 'seat' && seat?.permissions.view === false) return null;
    // PERM-02: an entity with view disabled is visible to its owners only.
    if (entity.perms?.view === false && !owner) return null;
    // D35 / TOK-04 + PERM-03: a name the audience may not see on the label is never sent. The
    // schema requires a string, so the neutral placeholder is the empty string.
    const label = entity.token?.labelVisibility;
    const coDm = audience.kind === 'seat' && seat?.role === 'codm';
    const hideName = label === 'dm' ? !coDm : label === 'owner' ? !(owner || coDm) : false;
    return hideName && entity.name !== '' ? { ...entity, name: '' } : entity;
  });
}

/** PERM-03: a library entry retains the source entity's visibility/ownership policy. */
export function viewPrefab(audience: Audience, prefab: Prefab, seat?: Seat): Prefab | null {
  if (audience.kind === 'host') return prefab;
  if (audience.kind !== 'seat' || seat?.role !== 'codm' || !seat.permissions.view) return null;
  // Older experimental blueprints did not capture visibility; keep them host-only.
  if (prefab.entity.owners === undefined) return null;
  return viewEntity(
    audience,
    { ...prefab.entity, id: prefab.id, owners: prefab.entity.owners },
    seat,
  ) === null
    ? null
    : prefab;
}

function viewScene(audience: Audience, scene: Scene, seat?: Seat): Scene {
  const key = viewKey(audience, seat);
  return memo(sceneCache, scene, key, () => {
    const entities: Scene['entities'] = {};
    let changed = false;
    for (const [id, entity] of Object.entries(scene.entities)) {
      const view = viewEntity(audience, entity, seat);
      if (view === null) changed = true;
      else {
        entities[id] = view;
        if (view !== entity) changed = true;
      }
    }
    return changed ? { ...scene, entities } : scene;
  });
}

export function visibleTo(audience: Audience, state: Campaign): Campaign {
  if (audience.kind === 'host') return state;
  return memo(campaignCache, state, audienceKey(audience), () => {
    const seat = audience.kind === 'seat' ? state.seats[audience.seatId] : undefined;
    const scenes: Campaign['scenes'] = {};
    let changed = false;
    for (const [id, scene] of Object.entries(state.scenes)) {
      const view = viewScene(audience, scene, seat);
      scenes[id] = view;
      if (view !== scene) changed = true;
    }
    // PERM-03: prefab blueprints may contain DM-layer content and private labels.
    const mayReadPrefabs =
      audience.kind === 'seat' && seat?.role === 'codm' && seat.permissions.view;
    const view = changed ? { ...state, scenes } : state;
    if (state.prefabs && !mayReadPrefabs) {
      const withoutPrefabs = { ...view };
      delete withoutPrefabs.prefabs;
      return withoutPrefabs;
    }
    if (state.prefabs) {
      const prefabs: NonNullable<Campaign['prefabs']> = {};
      let hidden = false;
      for (const [id, prefab] of Object.entries(state.prefabs)) {
        const allowed = viewPrefab(audience, prefab, seat);
        if (allowed) prefabs[id] = allowed;
        else hidden = true;
      }
      if (hidden) return { ...view, prefabs };
    }
    return view;
  });
}
