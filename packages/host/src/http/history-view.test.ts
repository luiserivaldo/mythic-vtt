import { describe, expect, it } from 'vitest';
import { reduceAction, type ActionEnvelope, type Audience } from '@mythic/shared';
import { ACTORS, IDS, makeCampaign, makeEntity } from '../../../shared/src/actions/testing.js';
import type { LogEntry } from '../storage/types.js';
import { historyPage } from './history-view.js';

function fixture() {
  let state = makeCampaign();
  const log: LogEntry[] = [];
  const apply = (
    type: string,
    payload: unknown,
    actor = ACTORS.host as ActionEnvelope['actor'],
  ) => {
    const envelope: ActionEnvelope = {
      id: IDS.action,
      type,
      payload,
      actor,
      campaignId: IDS.campaign,
      sceneId: IDS.scene,
      sessionId: IDS.session,
      seq: log.length + 1,
      ts: 1000,
      round: 2,
      turn: 1,
    };
    const result = reduceAction(state, envelope);
    state = result.state;
    log.push({ envelope, inversePatches: result.inversePatches });
  };
  apply('entity.create', {
    sceneId: IDS.scene,
    entity: makeEntity(IDS.entity, {
      name: 'Public hero',
      owners: [IDS.owner],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    }),
  });
  apply(
    'token.move',
    { sceneId: IDS.scene, entityId: IDS.entity, to: { x: 1, y: 0, z: 0 } },
    ACTORS.owner,
  );
  return {
    get state() {
      return state;
    },
    log,
    apply,
  };
}
const spectator: Audience = { kind: 'spectators' };

describe('history projection', () => {
  it('browses diffs in reverse order with seat/entity filters and stable pagination', () => {
    const f = fixture();
    const page = historyPage(f.state, 2, f.log, spectator, { limit: 1 });
    expect(page.entries.map((entry) => entry.seq)).toEqual([2]);
    expect(page.entries[0]).toMatchObject({ seatId: IDS.owner, round: 2, turn: 1 });
    expect(page.before).toBe(2);
    expect(
      historyPage(f.state, 2, f.log, spectator, { limit: 1, before: 2 }).entries.map(
        (entry) => entry.seq,
      ),
    ).toEqual([1]);
    expect(
      historyPage(f.state, 2, f.log, spectator, { limit: 50, seatId: IDS.owner }).entries,
    ).toHaveLength(1);
    expect(
      historyPage(f.state, 2, f.log, spectator, { limit: 50, entityId: IDS.other }).entries,
    ).toEqual([]);
    expect(
      historyPage(f.state, 2, f.log, spectator, { limit: 50, entityId: IDS.entity }).entries,
    ).toHaveLength(2);
    expect(JSON.stringify(page)).not.toMatch(/inversePatches|identityId|payload|clientRef/);
  });
  it('never reveals currently hidden entities through older public actions', () => {
    const f = fixture();
    f.apply('entity.setLayer', { sceneId: IDS.scene, entityId: IDS.entity, layer: 'dm' });
    expect(historyPage(f.state, 3, f.log, spectator, { limit: 50 }).entries).toEqual([]);
    expect(historyPage(f.state, 3, f.log, { kind: 'host' }, { limit: 50 }).entries).toHaveLength(3);
  });
  it('keeps the last private visibility after deletion instead of reviving old public names', () => {
    const f = fixture();
    f.apply('entity.setLayer', { sceneId: IDS.scene, entityId: IDS.entity, layer: 'dm' });
    f.apply('entity.delete', { sceneId: IDS.scene, entityId: IDS.entity });
    expect(historyPage(f.state, 4, f.log, spectator, { limit: 50 }).entries).toEqual([]);
    expect(historyPage(f.state, 4, f.log, { kind: 'host' }, { limit: 50 }).entries).toHaveLength(4);
  });
  it('filters historical and current label visibility, including ownership changes', () => {
    const f = fixture();
    const token = f.state.scenes[IDS.scene]?.entities[IDS.entity]?.token;
    f.apply('entity.update', {
      sceneId: IDS.scene,
      entityId: IDS.entity,
      changes: { token: { ...token, labelVisibility: 'owner' } },
    });
    f.apply('entity.setOwners', { sceneId: IDS.scene, entityId: IDS.entity, owners: [IDS.other] });
    const oldOwner = historyPage(
      f.state,
      4,
      f.log,
      { kind: 'seat', seatId: IDS.owner },
      { limit: 50 },
    );
    expect(JSON.stringify(oldOwner)).not.toContain('Public hero');
    expect(
      JSON.stringify(
        historyPage(f.state, 4, f.log, { kind: 'seat', seatId: IDS.other }, { limit: 50 }),
      ),
    ).toContain('Public hero');
    expect(JSON.stringify(historyPage(f.state, 4, f.log, spectator, { limit: 50 }))).not.toContain(
      'Public hero',
    );
  });
  it('uses current role and view privileges, not an old co-DM role', () => {
    const f = fixture();
    f.apply('entity.setLayer', { sceneId: IDS.scene, entityId: IDS.entity, layer: 'dm' });
    f.apply('seat.update', { seatId: IDS.coDm, role: 'player' });
    const view = historyPage(f.state, 4, f.log, { kind: 'seat', seatId: IDS.coDm }, { limit: 50 });
    expect(JSON.stringify(view)).not.toContain('Public hero');
  });
  it('retains authorized deletion diffs and strips identity binding changes', () => {
    const f = fixture();
    f.apply('entity.delete', { sceneId: IDS.scene, entityId: IDS.entity });
    f.apply('seat.assign', { seatId: IDS.owner, identityId: IDS.identity });
    const view = historyPage(f.state, 4, f.log, spectator, { limit: 50 });
    expect(view.entries.some((entry) => entry.type === 'entity.delete')).toBe(true);
    expect(JSON.stringify(view)).not.toContain(IDS.identity);
    expect(f.state.seats[IDS.owner]?.identityId).toBe(IDS.identity);
  });
});
