import { applyPatches, current, enablePatches, produce, produceWithPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { IDS, makeCampaign, makeEntity, testId } from '../actions/testing.js';
import type { Campaign } from '../schema/index.js';
import type { Audience } from './audience.js';
import { patchesFor } from './patches-for.js';
import { visibleTo } from './visible-to.js';

enablePatches();

const audiences: Record<string, Audience> = {
  owner: { kind: 'seat', seatId: IDS.owner },
  other: { kind: 'seat', seatId: IDS.other },
  spectators: { kind: 'spectators' },
};
const SECRET = 'SECRET-DM-NOTE';
const dmId = testId(10);
const pubId = testId(11);
const privId = testId(12);

function withEntities(): Campaign {
  return produce(makeCampaign(), (d) => {
    const s = d.scenes[IDS.scene];
    if (!s) return;
    s.entities[dmId] = makeEntity(dmId, { layer: 'dm', name: SECRET, owners: [IDS.owner] });
    s.entities[pubId] = makeEntity(pubId, { name: 'Visible orc' });
    s.entities[privId] = makeEntity(privId, {
      name: 'Hidden-label',
      owners: [IDS.owner],
      perms: { view: false },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
    });
  });
}

describe('visibleTo', () => {
  it('returns the host everything, by reference', () => {
    const s = withEntities();
    expect(visibleTo({ kind: 'host' }, s)).toBe(s);
  });

  it.each(Object.entries(audiences))('strips the DM layer for %s (even for its owner)', (_n, a) => {
    const json = JSON.stringify(visibleTo(a, withEntities()));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(dmId);
  });

  it('hides view-disabled entities from non-owners and masks owner-only labels', () => {
    const s = withEntities();
    const other = visibleTo(audiences.other as Audience, s).scenes[IDS.scene]?.entities ?? {};
    expect(privId in other).toBe(false);
    const owner = visibleTo(audiences.owner as Audience, s).scenes[IDS.scene]?.entities ?? {};
    expect(owner[privId]?.name).toBe('Hidden-label');
    expect(owner[pubId]?.name).toBe('Visible orc');
  });

  it('hides all entities when a seat-level view permission is disabled', () => {
    const s = produce(withEntities(), (d) => {
      const seat = d.seats[IDS.other];
      if (seat) seat.permissions.view = false;
    });
    expect(visibleTo(audiences.other as Audience, s).scenes[IDS.scene]?.entities).toEqual({});
  });

  it('masks owner-only token labels for non-owners', () => {
    const s = produce(withEntities(), (d) => {
      const e = d.scenes[IDS.scene]?.entities[pubId];
      if (e) {
        e.owners = [IDS.owner];
        e.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' };
      }
    });
    expect(visibleTo(audiences.other as Audience, s).scenes[IDS.scene]?.entities[pubId]?.name).toBe(
      '',
    );
    expect(visibleTo(audiences.owner as Audience, s).scenes[IDS.scene]?.entities[pubId]?.name).toBe(
      'Visible orc',
    );
  });

  it('does not mutate its input and is stable across calls', () => {
    const s = withEntities();
    const snapshot = JSON.stringify(s);
    const a = visibleTo(audiences.other as Audience, s);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(visibleTo(audiences.other as Audience, s)).toBe(a);
  });
});

describe('patchesFor (non-leak)', () => {
  const move = (layer: 'dm' | 'tokens') => (before: Campaign) =>
    produce(before, (d) => {
      const e = d.scenes[IDS.scene]?.entities[pubId];
      if (e) e.layer = layer;
    });

  it('moving an entity onto the DM layer becomes a removal for players and spectators', () => {
    const before = withEntities();
    const after = move('dm')(before);
    for (const a of Object.values(audiences)) {
      const patches = patchesFor(a, before, after);
      expect(patches).toEqual([{ op: 'remove', path: ['scenes', IDS.scene, 'entities', pubId] }]);
    }
    expect(patchesFor({ kind: 'host' }, before, after)).toEqual([
      { op: 'replace', path: ['scenes', IDS.scene, 'entities', pubId, 'layer'], value: 'dm' },
    ]);
  });

  it('moving an entity off the DM layer becomes an add; no earlier DM state is revealed', () => {
    const before = withEntities();
    const after = produce(before, (d) => {
      const e = d.scenes[IDS.scene]?.entities[dmId];
      if (e) e.layer = 'tokens';
    });
    const patches = patchesFor(audiences.other as Audience, before, after);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ op: 'add', path: ['scenes', IDS.scene, 'entities', dmId] });
  });

  it('edits to DM-layer entities produce no patches for players', () => {
    const before = withEntities();
    const after = produce(before, (d) => {
      const e = d.scenes[IDS.scene]?.entities[dmId];
      if (e) {
        e.name = 'Changed secret';
        e.transform.position.x = 9;
      }
    });
    for (const a of Object.values(audiences)) expect(patchesFor(a, before, after)).toEqual([]);
    expect(JSON.stringify(patchesFor(audiences.other as Audience, before, after))).not.toContain(
      'secret',
    );
  });

  it('applying audience patches to the audience view equals the new audience view', () => {
    const before = withEntities();
    const after = produce(before, (d) => {
      const s = d.scenes[IDS.scene];
      if (!s) return;
      s.name = 'Renamed';
      const e = s.entities[pubId];
      if (e) e.transform.position.x = 4;
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test removes a known key
      delete s.entities[dmId];
      s.entities[testId(13)] = makeEntity(testId(13), { layer: 'dm', name: SECRET });
    });
    for (const a of Object.values(audiences)) {
      const patched = applyPatches(visibleTo(a, before), patchesFor(a, before, after));
      expect(patched).toEqual(visibleTo(a, after));
    }
  });
});

describe('patchesFor with raw patches (hybrid translation, D21)', () => {
  const scenes = [
    [
      'entity edit',
      (d: Campaign) => {
        const e = d.scenes[IDS.scene]?.entities[pubId];
        if (e) e.transform.position.z = 3;
      },
    ],
    [
      'layer to dm',
      (d: Campaign) => {
        const e = d.scenes[IDS.scene]?.entities[pubId];
        if (e) e.layer = 'dm';
      },
    ],
    [
      'layer off dm',
      (d: Campaign) => {
        const e = d.scenes[IDS.scene]?.entities[dmId];
        if (e) e.layer = 'tokens';
      },
    ],
    [
      'dm entity edit',
      (d: Campaign) => {
        const e = d.scenes[IDS.scene]?.entities[dmId];
        if (e) e.name = 'x';
      },
    ],
    [
      'perm view toggled',
      (d: Campaign) => {
        const e = d.scenes[IDS.scene]?.entities[privId];
        if (e) e.perms = { view: true };
      },
    ],
    [
      'scene rename',
      (d: Campaign) => {
        const s = d.scenes[IDS.scene];
        if (s) s.name = 'N';
      },
    ],
    [
      'scene added (fallback)',
      (d: Campaign) => {
        const s = d.scenes[IDS.scene];
        if (s) d.scenes[testId(20)] = { ...structuredClone(current(s)), id: testId(20) };
      },
    ],
    [
      'entities replaced (fallback)',
      (d: Campaign) => {
        const s = d.scenes[IDS.scene];
        if (s) s.entities = {};
      },
    ],
    [
      'activeSceneId',
      (d: Campaign) => {
        d.activeSceneId = null;
      },
    ],
  ] as const;

  it.each(scenes)('%s: matches the diff oracle and never contains DM data', (_n, recipe) => {
    const before = withEntities();
    const [after, raw] = produceWithPatches(before, recipe);
    for (const a of Object.values(audiences)) {
      const fast = patchesFor(a, before, after, raw);
      const view = visibleTo(a, before);
      expect(applyPatches(view, fast)).toEqual(visibleTo(a, after));
      if (_n === 'dm entity edit') expect(fast).toEqual([]);
    }
  });
});
