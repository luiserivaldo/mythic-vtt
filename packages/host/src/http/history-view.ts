import {
  applyPatches,
  current as plainDraft,
  enablePatches,
  isDraft,
  produce,
  type Patch,
} from 'immer';
import { HISTORY_SCAN_LIMIT } from '../storage/history-log-reader.js';
import {
  diffPatches,
  viewEntity,
  visibleTo,
  type Entity,
  type Audience,
  type Campaign,
  type HistoryPage,
  type HistoryQuery,
} from '@mythic/shared';
import type { LogEntry } from '../storage/types.js';
enablePatches();

/** PERM-03: use today's seat privileges, and intersect historical and current entity visibility. */
function projection(
  state: Campaign,
  current: Campaign,
  audience: Audience,
  latestEntities: ReadonlyMap<string, Entity>,
  work?: { projectedEntities: number },
  includeSeats = false,
): unknown {
  const seat = audience.kind === 'seat' ? current.seats[audience.seatId] : undefined;
  const filtered = visibleTo(audience, { ...state, seats: current.seats });
  const scenes: Campaign['scenes'] = {};
  for (const scene of Object.values(filtered.scenes)) {
    const entities: Record<string, Entity> = {};
    for (const entity of Object.values(scene.entities)) {
      if (work) work.projectedEntities++;
      let view = viewEntity(audience, entity, seat);
      const now =
        latestEntities.get(`${scene.id}/${entity.id}`) ??
        current.scenes[scene.id]?.entities[entity.id];
      if (!view || (now && !viewEntity(audience, now, seat))) continue;
      // A now-private label must not be revealed by an older public log entry.
      if (now?.token && audience.kind !== 'host') {
        const probe = viewEntity(audience, { ...now, name: 'label-probe' }, seat);
        if (probe?.name === '') {
          view = entity.token
            ? viewEntity(
                audience,
                {
                  ...entity,
                  owners: now.owners,
                  token: { ...entity.token, labelVisibility: now.token.labelVisibility },
                },
                seat,
              )
            : { ...view, name: '' };
          if (view) view = { ...view, owners: entity.owners };
        }
      }
      if (view) entities[entity.id] = view;
    }
    scenes[scene.id] = { ...scene, entities };
  }
  // Identity bindings are authentication metadata, never history content.
  const seats = Object.fromEntries(
    Object.entries(includeSeats ? state.seats : {}).map(([id, value]) => {
      const view: Record<string, unknown> = { ...value };
      delete view['identityId'];
      return [id, view];
    }),
  );
  // Re-filter references (for example initiative order) after intersecting entity visibility.
  return { ...visibleTo(audience, { ...filtered, scenes }), seats };
}

function plain<T extends object>(value: T): T {
  return structuredClone(isDraft(value) ? plainDraft(value) : value);
}

/** Only touched scene/entity branches enter privacy projection and diffing. */
function scoped(
  state: Campaign,
  baseline: Campaign,
  paths: readonly Patch['path'][],
  entityId?: string,
): Campaign {
  const scenes: Campaign['scenes'] = {};
  const fields: Record<string, unknown> = {};
  for (const path of paths) {
    const [root, id, field, member] = path;
    if (root !== 'scenes') {
      if (!entityId && typeof root === 'string')
        fields[root] = (state as unknown as Record<string, unknown>)[root];
      continue;
    }
    const ids = typeof id === 'string' ? [id] : Object.keys(state.scenes);
    for (const sceneId of ids) {
      const scene = state.scenes[sceneId];
      if (!scene) continue;
      let view = scenes[sceneId];
      if (!view) {
        const metadata = Object.fromEntries(
          Object.entries(scene)
            .filter(([key]) => key !== 'entities')
            .map(([key, value]) => [
              key,
              value && typeof value === 'object' ? plain(value) : value,
            ]),
        );
        view = { ...metadata, entities: {} } as Campaign['scenes'][string];
        scenes[sceneId] = view;
      }
      // A whole scene/collection carries all its entities; an ordinary entity edit carries one.
      const members = entityId
        ? [entityId]
        : field === 'entities' && typeof member === 'string'
          ? [member]
          : path.length <= 2 || field === 'entities'
            ? Object.keys(scene.entities)
            : [];
      for (const memberId of members) {
        const entity = scene.entities[memberId];
        if (entity) view.entities[memberId] = plain(entity);
      }
    }
  }
  const extra = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value && typeof value === 'object' ? plain(value) : value,
    ]),
  );
  const model: Campaign = {
    id: baseline.id,
    name: baseline.name,
    schemaVersion: baseline.schemaVersion,
    settings: baseline.settings,
    seats: baseline.seats,
    activeSceneId: baseline.activeSceneId,
    ...extra,
    scenes,
  };
  for (const [key, value] of Object.entries(fields))
    if (value === undefined) Reflect.deleteProperty(model, key);
  return model;
}
function relevant(paths: readonly Patch['path'][], change: Patch, entityId?: string): boolean {
  if (entityId)
    return (
      change.path[0] === 'scenes' && change.path[2] === 'entities' && change.path[3] === entityId
    );
  return paths.some((path) => {
    const prefix =
      path[0] === 'scenes' ? path.slice(0, path[2] === 'entities' ? 4 : 3) : path.slice(0, 1);
    return prefix.every((part, index) => change.path[index] === part);
  });
}
function touchesEntity(paths: readonly Patch['path'][], id: string): boolean {
  return paths.some(
    (path) =>
      path[0] === 'scenes' && (path.length <= 3 || (path[2] === 'entities' && path[3] === id)),
  );
}

export interface HistoryScan {
  page: HistoryPage;
  checkpoint: Campaign;
  latestEntities: Map<string, Entity>;
  consumed: number;
  work: { scanned: number; projectedEntities: number };
}
/** One Immer draft per bounded chunk avoids cloning the entity record for every inverse. */
export function scanHistory(
  current: Campaign,
  start: Campaign,
  log: readonly LogEntry[],
  audience: Audience,
  query: HistoryQuery,
  remembered: ReadonlyMap<string, Entity> = new Map(),
  hasMore = false,
  currentSeq = Number.MAX_SAFE_INTEGER,
): HistoryScan {
  const entries: HistoryPage['entries'] = [],
    latestEntities = new Map(remembered);
  let consumed = 0,
    lastSeq: number | undefined;
  const work = { scanned: 0, projectedEntities: 0 };
  let rememberedBytes = 0;
  for (const value of latestEntities.values()) rememberedBytes += JSON.stringify(value).length;
  const checkpoint = produce(start, (draft) => {
    for (const entry of log) {
      if (consumed >= HISTORY_SCAN_LIMIT) break;
      consumed++;
      work.scanned++;
      const { envelope } = entry;
      if (envelope.seq > currentSeq) continue;
      const paths = entry.inversePatches.map((p) => p.path);
      const eligible =
        (query.before === undefined || envelope.seq < query.before) &&
        (query.seatId === undefined || envelope.actor.seatId === query.seatId) &&
        (query.entityId === undefined || touchesEntity(paths, query.entityId));
      const after = eligible
        ? projection(
            scoped(draft, current, paths, query.entityId),
            current,
            audience,
            latestEntities,
            work,
            paths.some((path) => path[0] === 'seats'),
          )
        : undefined;
      applyPatches(draft, entry.inversePatches);
      // Capture only restored tombstones; never walk all live entities on each entry.
      const restored = scoped(draft, current, paths, query.entityId);
      for (const scene of Object.values(restored.scenes))
        for (const entity of Object.values(scene.entities)) {
          const key = `${scene.id}/${entity.id}`;
          if (!current.scenes[scene.id]?.entities[entity.id] && !latestEntities.has(key)) {
            const visibility: Entity = {
              id: entity.id,
              name: '',
              layer: entity.layer,
              owners: entity.owners,
              transform: entity.transform,
              ...(entity.perms ? { perms: entity.perms } : {}),
              ...(entity.token
                ? {
                    token: {
                      sizeCells: entity.token.sizeCells,
                      heightCells: entity.token.heightCells,
                      labelVisibility: entity.token.labelVisibility,
                    },
                  }
                : {}),
            };
            rememberedBytes += JSON.stringify(visibility).length;
            if (latestEntities.size >= 10000 || rememberedBytes > 2 * 1024 * 1024)
              throw new Error('history visibility budget exceeded');
            latestEntities.set(key, visibility);
          }
        }
      if (eligible) {
        const before = projection(
          restored,
          current,
          audience,
          latestEntities,
          work,
          paths.some((path) => path[0] === 'seats'),
        );
        const changes = diffPatches(before, after).filter((change) =>
          relevant(paths, change, query.entityId),
        );
        if (changes.length)
          entries.push({
            sessionId: envelope.sessionId,
            seq: envelope.seq,
            type: envelope.type,
            ts: envelope.ts,
            ...(envelope.actor.seatId ? { seatId: envelope.actor.seatId } : {}),
            ...(envelope.round !== undefined ? { round: envelope.round } : {}),
            ...(envelope.turn !== undefined ? { turn: envelope.turn } : {}),
            changes,
          });
      }
      lastSeq = envelope.seq;
      if (entries.length >= query.limit) break;
    }
  });
  const more = hasMore || consumed < log.length;
  return {
    page: { entries, ...(more && lastSeq !== undefined ? { before: lastSeq } : {}) },
    checkpoint,
    latestEntities,
    consumed,
    work,
  };
}

/** Test/internal convenience for a bounded, chronological log window. */
export function historyPage(
  current: Campaign,
  seq: number,
  log: readonly LogEntry[],
  audience: Audience,
  query: HistoryQuery,
): HistoryPage {
  const window = log
    .slice(-HISTORY_SCAN_LIMIT)
    .filter((item) => item.envelope.seq <= seq)
    .sort((a, b) => b.envelope.seq - a.envelope.seq);
  return scanHistory(
    current,
    current,
    window,
    audience,
    query,
    new Map(),
    log.length > window.length,
  ).page;
}
