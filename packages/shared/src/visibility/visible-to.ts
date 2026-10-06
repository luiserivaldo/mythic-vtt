import type { Campaign, Entity, Scene } from '../schema/index.js';
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

/** The audience's view of one entity, or null if it must not be sent at all. */
export function viewEntity(audience: Audience, entity: Entity): Entity | null {
  if (audience.kind === 'host') return entity;
  return memo(entityCache, entity, audienceKey(audience), () => {
    const owner = ownsEntity(audience, entity);
    // LAY-04: the DM layer is host-only, even for owners of an entity moved onto it.
    if (entity.layer === 'dm') return null;
    // PERM-02: an entity with view disabled is visible to its owners only.
    if (entity.perms?.view === false && !owner) return null;
    const label = entity.token?.labelVisibility;
    const hideName = label === 'dm' || (label === 'owner' && !owner);
    return hideName ? { ...entity, name: '' } : entity;
  });
}

function viewScene(audience: Audience, scene: Scene): Scene {
  return memo(sceneCache, scene, audienceKey(audience), () => {
    const entities: Scene['entities'] = {};
    let changed = false;
    for (const [id, entity] of Object.entries(scene.entities)) {
      const view = viewEntity(audience, entity);
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
    const scenes: Campaign['scenes'] = {};
    let changed = false;
    for (const [id, scene] of Object.entries(state.scenes)) {
      const view = viewScene(audience, scene);
      scenes[id] = view;
      if (view !== scene) changed = true;
    }
    return changed ? { ...state, scenes } : state;
  });
}
