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

// D32: co-DM seats see the DM layer; players and spectators never do.
describe('co-DM audience (D32)', () => {
  const coDm: Audience = { kind: 'seat', seatId: IDS.coDm };
  const players = [audiences.owner, audiences.other, audiences.spectators] as Audience[];
  const entPath = (id: string) => ['scenes', IDS.scene, 'entities', id];

  it('includes DM-layer entities in the co-DM snapshot only', () => {
    const s = withEntities();
    expect(visibleTo(coDm, s).scenes[IDS.scene]?.entities[dmId]?.name).toBe(SECRET);
    for (const a of players) expect(JSON.stringify(visibleTo(a, s))).not.toContain(SECRET);
  });

  it('stops being a co-DM view once the role is demoted', () => {
    const s = withEntities();
    const demoted = produce(s, (d) => {
      const seat = d.seats[IDS.coDm];
      if (seat) seat.role = 'player';
    });
    expect(visibleTo(coDm, demoted).scenes[IDS.scene]?.entities[dmId]).toBeUndefined();
  });

  const recipes: Record<string, (d: Campaign) => void> = {
    create: (d) => {
      const s = d.scenes[IDS.scene];
      if (s) s.entities[testId(13)] = makeEntity(testId(13), { layer: 'dm', name: SECRET });
    },
    edit: (d) => {
      const e = d.scenes[IDS.scene]?.entities[dmId];
      if (e) e.name = 'Changed';
    },
    move: (d) => {
      const e = d.scenes[IDS.scene]?.entities[dmId];
      if (e) e.transform.position.x = 9;
    },
    delete: (d) => {
      const s = d.scenes[IDS.scene];
      if (s) Reflect.deleteProperty(s.entities, dmId);
    },
    'layer onto dm': (d) => {
      const e = d.scenes[IDS.scene]?.entities[pubId];
      if (e) e.layer = 'dm';
    },
    'layer off dm': (d) => {
      const e = d.scenes[IDS.scene]?.entities[dmId];
      if (e) e.layer = 'tokens';
    },
  };

  it.each(Object.entries(recipes))('%s: co-DM gets patches, players get none', (name, recipe) => {
    const before = withEntities();
    const [after, raw] = produceWithPatches(before, recipe);
    const fast = patchesFor(coDm, before, after, raw);
    expect(applyPatches(visibleTo(coDm, before), fast)).toEqual(visibleTo(coDm, after));
    expect(fast).toEqual(patchesFor(coDm, before, after));
    const ops = fast.map((p) => p.op);
    if (name === 'create') expect(ops).toEqual(['add']);
    if (name === 'delete') expect(ops).toEqual(['remove']);
    if (name === 'edit' || name === 'move') expect(fast.length).toBeGreaterThan(0);
    if (name === 'layer onto dm')
      expect(fast).toEqual([{ op: 'replace', path: [...entPath(pubId), 'layer'], value: 'dm' }]);
    if (name !== 'layer onto dm' && name !== 'layer off dm') {
      for (const a of players) expect(patchesFor(a, before, after, raw)).toEqual([]);
    }
    if (name !== 'layer off dm') {
      for (const a of players) {
        expect(JSON.stringify(patchesFor(a, before, after, raw))).not.toContain(SECRET);
      }
    }
  });

  it('role promotion changes the audience view of the same state', () => {
    const before = withEntities();
    const after = produce(before, (d) => {
      const seat = d.seats[IDS.other];
      if (seat) seat.role = 'codm';
    });
    const other = audiences.other as Audience;
    expect(visibleTo(other, before).scenes[IDS.scene]?.entities[dmId]).toBeUndefined();
    expect(visibleTo(other, after).scenes[IDS.scene]?.entities[dmId]).toBeDefined();
  });
});

describe('label visibility (D35, TOK-04 + PERM-03)', () => {
  const NAME = 'Archmage Zorn the Unseen';
  const labelId = testId(20);
  const host: Audience = { kind: 'host' };
  const coDm: Audience = { kind: 'seat', seatId: IDS.coDm };
  const owner = audiences.owner as Audience;
  const other = audiences.other as Audience;
  const spectators = audiences.spectators as Audience;
  const everyone: [string, Audience][] = [
    ['host', host],
    ['co-DM', coDm],
    ['owner', owner],
    ['other player', other],
    ['spectator', spectators],
  ];
  type Mode = 'all' | 'owner' | 'dm';
  // Who may read the real name, per mode.
  const allowed: Record<Mode, string[]> = {
    all: ['host', 'co-DM', 'owner', 'other player', 'spectator'],
    owner: ['host', 'co-DM', 'owner'],
    dm: ['host', 'co-DM'],
  };

  const withLabel = (mode: Mode): Campaign =>
    produce(makeCampaign(), (d) => {
      const s = d.scenes[IDS.scene];
      if (!s) return;
      s.entities[labelId] = makeEntity(labelId, {
        name: NAME,
        owners: [IDS.owner],
        token: { sizeCells: 1, heightCells: 1, labelVisibility: mode },
      });
    });
  const nameFor = (a: Audience, s: Campaign) =>
    visibleTo(a, s).scenes[IDS.scene]?.entities[labelId]?.name;

  describe.each(['all', 'owner', 'dm'] as Mode[])('mode %s', (mode) => {
    it.each(everyone)('%s: sees the name only when allowed, never in serialized form', (who, a) => {
      const s = withLabel(mode);
      const view = visibleTo(a, s);
      expect(view.scenes[IDS.scene]?.entities[labelId]).toBeDefined(); // the token itself stays
      if (allowed[mode].includes(who)) expect(nameFor(a, s)).toBe(NAME);
      else {
        expect(nameFor(a, s)).toBe('');
        expect(JSON.stringify(view)).not.toContain(NAME);
      }
    });
  });

  it('keeps every other field of a masked entity intact', () => {
    const s = withLabel('dm');
    const real = s.scenes[IDS.scene]?.entities[labelId];
    expect(nameFor(other, s)).toBe('');
    expect({ ...visibleTo(other, s).scenes[IDS.scene]?.entities[labelId], name: NAME }).toEqual(
      real,
    );
  });

  const hiddenFrom = (mode: Mode) => everyone.filter(([who]) => !allowed[mode].includes(who));

  it('rename while hidden yields no patch and no name for non-allowed audiences', () => {
    const before = withLabel('dm');
    const [after, raw] = produceWithPatches(before, (d) => {
      const e = d.scenes[IDS.scene]?.entities[labelId];
      if (e) e.name = 'Renamed-Secret-Name';
    });
    for (const [who, a] of everyone) {
      const fast = patchesFor(a, before, after, raw);
      expect(fast, who).toEqual(patchesFor(a, before, after));
      if (allowed.dm.includes(who)) expect(fast.length, who).toBeGreaterThan(0);
      else expect(fast, who).toEqual([]);
    }
  });

  it('creating a hidden-label entity never carries the name for non-allowed audiences', () => {
    const before = makeCampaign();
    const [after, raw] = produceWithPatches(before, (d) => {
      const s = d.scenes[IDS.scene];
      if (s)
        s.entities[labelId] = makeEntity(labelId, {
          name: NAME,
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
        });
    });
    for (const [who, a] of hiddenFrom('owner')) {
      const fast = patchesFor(a, before, after, raw);
      expect(fast, who).toEqual(patchesFor(a, before, after));
      expect(JSON.stringify(fast), who).not.toContain(NAME);
      expect(
        fast.map((p) => p.op),
        who,
      ).toEqual(['add']);
    }
  });

  const flips: [Mode, Mode][] = [
    ['all', 'owner'],
    ['all', 'dm'],
    ['owner', 'all'],
    ['owner', 'dm'],
    ['dm', 'all'],
    ['dm', 'owner'],
  ];
  it.each(flips)('flipping labelVisibility %s -> %s reveals or hides consistently', (from, to) => {
    const before = withLabel(from);
    const [after, raw] = produceWithPatches(before, (d) => {
      const t = d.scenes[IDS.scene]?.entities[labelId]?.token;
      if (t) t.labelVisibility = to;
    });
    for (const [who, a] of everyone) {
      const fast = patchesFor(a, before, after, raw);
      expect(fast, who).toEqual(patchesFor(a, before, after)); // oracle
      expect(applyPatches(visibleTo(a, before), fast), who).toEqual(visibleTo(a, after));
      const sees = (m: Mode) => allowed[m].includes(who);
      if (!sees(from) && sees(to)) expect(JSON.stringify(fast), who).toContain(NAME);
      if (!sees(to)) expect(JSON.stringify(fast), who).not.toContain(NAME);
    }
  });

  it('changing owners flips the name for the affected seat (owner mode)', () => {
    const before = withLabel('owner');
    const [after, raw] = produceWithPatches(before, (d) => {
      const e = d.scenes[IDS.scene]?.entities[labelId];
      if (e) e.owners = [IDS.other];
    });
    for (const [who, a] of everyone) {
      const fast = patchesFor(a, before, after, raw);
      expect(fast, who).toEqual(patchesFor(a, before, after));
      expect(applyPatches(visibleTo(a, before), fast), who).toEqual(visibleTo(a, after));
    }
    expect(nameFor(other, after)).toBe(NAME);
    expect(nameFor(owner, after)).toBe('');
  });

  it('demoting a co-DM masks dm-only names in its view', () => {
    const s = withLabel('dm');
    const demoted = produce(s, (d) => {
      const seat = d.seats[IDS.coDm];
      if (seat) seat.role = 'player';
    });
    expect(nameFor(coDm, s)).toBe(NAME);
    expect(nameFor(coDm, demoted)).toBe('');
  });
});
