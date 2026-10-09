import { applyPatches } from 'immer';
import {
  diffPatches,
  viewEntity,
  type Audience,
  type Campaign,
  type HistoryPage,
  type HistoryQuery,
} from '@mythic/shared';
import type { LogEntry } from '../storage/types.js';

/** PERM-03: use today's seat privileges, and intersect historical and current entity visibility. */
function projection(state: Campaign, current: Campaign, audience: Audience): unknown {
  const seat = audience.kind === 'seat' ? current.seats[audience.seatId] : undefined;
  const scenes: Record<string, unknown> = {};
  for (const scene of Object.values(state.scenes)) {
    const entities: Record<string, unknown> = {};
    for (const entity of Object.values(scene.entities)) {
      let view = viewEntity(audience, entity, seat);
      const now = current.scenes[scene.id]?.entities[entity.id];
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
    Object.entries(state.seats).map(([id, value]) => {
      const view: Record<string, unknown> = { ...value };
      delete view['identityId'];
      return [id, view];
    }),
  );
  return { ...state, seats, scenes };
}

/** Reverse the stored inverse patches locally; never send raw payloads or inverse patches. */
export function historyPage(
  current: Campaign,
  seq: number,
  log: readonly LogEntry[],
  audience: Audience,
  query: HistoryQuery,
): HistoryPage {
  let after = current;
  const entries: HistoryPage['entries'] = [];
  for (const entry of [...log]
    .filter((item) => item.envelope.seq <= seq)
    .sort((a, b) => b.envelope.seq - a.envelope.seq)) {
    const { envelope } = entry;
    const before = applyPatches(after, entry.inversePatches);
    if (
      (query.before === undefined || envelope.seq < query.before) &&
      (query.seatId === undefined || envelope.actor.seatId === query.seatId)
    ) {
      let changes = diffPatches(
        projection(before, current, audience),
        projection(after, current, audience),
      );
      if (query.entityId !== undefined)
        changes = changes.filter(
          (change) =>
            change.path[0] === 'scenes' &&
            change.path[2] === 'entities' &&
            change.path[3] === query.entityId,
        );
      // Even an action's existence/type can disclose a secret entity. Omit empty projected diffs.
      if (changes.length > 0)
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
      if (entries.length > query.limit) break;
    }
    after = before;
  }
  const more = entries.length > query.limit;
  if (more) entries.pop();
  const last = entries.at(-1);
  return { entries, ...(more && last ? { before: last.seq } : {}) };
}
