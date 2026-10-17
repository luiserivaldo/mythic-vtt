import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// FOG-01 (MV-295; D47 2bde4e3) / PERM-03: the vision contract over the wire. A closed secret door
// reaches players and spectators only as a plain wall, an open one only as an ordinary open door,
// and the `secret` flag never at all; wall and fog-region names never reach them; walls, fog
// regions and sight blocking are DM data; and doors open for a player only with the Doors tool.
// Frames are captured raw at the transport level, so the check does not depend on the app.

let table: Table;
let host: RawClient;
const SCENE = testUlid('SCENE', 295);
const SEAT = testUlid('SEAT', 295);
const PLAYER_ID = testUlid('PLAYER', 295);
const SPECTATOR_ID = testUlid('SPECT', 295);
const SECRET = testUlid('SECRETDOOR', 1);
const DOOR = testUlid('DOOR', 1);
const FOG = testUlid('FOGREGN', 1);
const CRATE = testUlid('CRATE', 1);
const MINE = testUlid('TOKEN', 1);
const RAW_WALL = testUlid('RAWWAL', 1);
const RAW_FOG = testUlid('RAWFOG', 1);
const PLAIN_WALL = testUlid('WALL', 1);

const transform = (x: number, z: number) => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});
const segment = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
];
const region = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 3 },
  { x: 0, z: 3 },
];
// DM notes that must never reach a player or spectator socket (renames included).
const NAMES = ['Hidden panel', 'Vestry door', 'North wall', 'Dragon lair', 'Lever', 'Throne room'];
const base = (id: string, layer: string, name: string, x: number) => ({
  id,
  layer,
  name,
  // The seat owns everything and holds every grant: none of it may open DM vision data.
  owners: [SEAT],
  perms: { view: true, move: true, edit: true, delete: true },
  transform: transform(x, 4),
});

async function ok(reply: Promise<Reply>): Promise<number> {
  const r = await reply;
  expect(r, JSON.stringify(r)).toMatchObject({ t: 'ack' });
  return r.seq ?? -1;
}
async function rejected(reply: Promise<Reply>): Promise<void> {
  const r = await reply;
  expect(r, JSON.stringify(r)).toMatchObject({ t: 'reject' });
}

type Patch = { op: string; path: (string | number)[]; value?: unknown };
type Frame = { t: string; state?: Snapshot; patches?: Patch[] };
type Snapshot = { scenes?: Record<string, { entities?: Record<string, unknown> }> };

/**
 * What a frame says about the secret door: the entity in a snapshot, or each patch touching it.
 * Other doors legitimately carry a `door` field, so the check looks at this entity only.
 */
function secretDoorFragments(raw: string): { op: string; path: string; json: string }[] {
  const frame = JSON.parse(raw) as Frame;
  if (frame.t === 'snapshot') {
    const entity = frame.state?.scenes?.[SCENE]?.entities?.[SECRET];
    return entity ? [{ op: 'snapshot', path: '', json: JSON.stringify(entity) }] : [];
  }
  if (frame.t !== 'patch') return [];
  return (frame.patches ?? [])
    .filter((p) => p.path.includes(SECRET) || JSON.stringify(p.value ?? null).includes(SECRET))
    .map((p) => ({ op: p.op, path: p.path.join('/'), json: JSON.stringify(p) }));
}

/** While the secret door is closed, a frame may only take away an already-open door. */
function expectNoClosedSecretDoor(frames: readonly string[], who: string): void {
  for (const raw of frames)
    for (const fragment of secretDoorFragments(raw)) {
      if (fragment.op === 'remove' && fragment.path.endsWith('/wall/door')) continue;
      expect(fragment.json, `${who}: closed secret door leaked`).not.toContain('"door"');
    }
}

function wallOf(c: RawClient, id: string): unknown {
  const entity = (c.state as Snapshot | undefined)?.scenes?.[SCENE]?.entities?.[id] as
    { wall?: unknown } | undefined;
  return entity?.wall;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'host',
    identityId: testUlid('HOST', 295),
    identitySecret: 'host-secret',
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('secret doors, vision names and DM-only vision data never reach players or spectators', async () => {
  test.setTimeout(60_000);
  // --- setup ------------------------------------------------------------------------------------
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Crypt' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  await ok(host.intent('scene.update', { sceneId: SCENE, vision: { dynamicLighting: true } }));
  await ok(host.intent('seat.create', { seatId: SEAT, label: 'Rogue' }));
  await ok(
    host.intent('permission.update', {
      target: 'seat',
      seatId: SEAT,
      permissions: { view: true, move: true, edit: true, delete: true },
    }),
  );
  const create = (entity: Record<string, unknown>) =>
    host.intent('entity.create', { sceneId: SCENE, entity });
  await ok(
    create({
      ...base(SECRET, 'map', 'Hidden panel', 2),
      wall: { points: segment, door: { open: false, secret: true } },
    }),
  );
  await ok(
    create({
      ...base(DOOR, 'map', 'Vestry door', 4),
      wall: { points: segment, door: { open: false } },
    }),
  );
  await ok(create({ ...base(PLAIN_WALL, 'map', 'North wall', 0), wall: { points: segment } }));
  await ok(
    create({
      ...base(CRATE, 'props', 'Crate', 6),
      shape: { kind: 'box', color: '#888888', walkable: false },
    }),
  );
  await ok(
    create({
      ...base(MINE, 'tokens', 'Rogue', 8),
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    }),
  );
  await ok(
    create({
      ...base(FOG, 'map', 'Dragon lair', 10),
      fogRegion: { points: region },
    }),
  );

  let player = await RawClient.connect(table, {
    name: 'player',
    identityId: PLAYER_ID,
    identitySecret: 'player-secret',
  });
  const spectator = await RawClient.connect(table, {
    name: 'spectator',
    identityId: SPECTATOR_ID,
    identitySecret: 'spectator-secret',
  });
  await player.waitFor('snapshot', () => player.state !== undefined);
  await spectator.waitFor('snapshot', () => spectator.state !== undefined);
  player.join(SEAT);
  await host.waitFor('seated', () => {
    const seats = (host.state as { seats: Record<string, { identityId: string | null }> }).seats;
    return seats[SEAT]?.identityId === PLAYER_ID;
  });
  const settle = async (clients: RawClient[]) => {
    const target = host.lastSeq;
    await Promise.all(clients.map((c) => c.waitForSeq(target)));
  };
  await settle([player, spectator]);
  const allFrames: { who: string; frames: string[] }[] = [];

  // Players see the switch, walls (D47 (4)) and fog regions (map layer), the secret door as a plain
  // wall, and every wall and region name blank.
  const entityOf = (c: RawClient, id: string) =>
    (c.state as Snapshot | undefined)?.scenes?.[SCENE]?.entities?.[id] as
      { name?: string; fogRegion?: unknown } | undefined;
  for (const c of [player, spectator]) {
    expect(wallOf(c, SECRET)).toEqual({ points: segment });
    expect(wallOf(c, DOOR)).toEqual({ points: segment, door: { open: false } });
    expect(entityOf(c, FOG)?.fogRegion).toEqual({ points: region });
    for (const id of [SECRET, DOOR, PLAIN_WALL, FOG]) expect(entityOf(c, id)?.name).toBe('');
    expect(
      (c.state as { scenes: Record<string, { vision?: unknown }> }).scenes[SCENE]?.vision,
    ).toEqual({ dynamicLighting: true });
  }
  expect(wallOf(host, SECRET)).toEqual({ points: segment, door: { open: false, secret: true } });
  expect(entityOf(host, FOG)?.name).toBe('Dragon lair');

  // --- the player's raw intents: walls, sight blocking and doors are DM data ----------------------
  await rejected(
    player.intent('entity.create', {
      sceneId: SCENE,
      entity: { ...base(RAW_WALL, 'map', 'My wall', 12), wall: { points: segment } },
    }),
  );
  await rejected(
    player.intent('entity.create', {
      sceneId: SCENE,
      entity: { ...base(RAW_FOG, 'map', 'My fog', 12), fogRegion: { points: region } },
    }),
  );
  await rejected(
    player.intent('entity.update', {
      sceneId: SCENE,
      entityId: CRATE,
      changes: { blocksSight: true },
    }),
  );
  await rejected(
    player.intent('entity.update', {
      sceneId: SCENE,
      entityId: MINE,
      changes: { blocksSight: true },
    }),
  );
  await rejected(
    player.intent('entity.update', {
      sceneId: SCENE,
      entityId: DOOR,
      changes: { transform: transform(5, 5) },
    }),
  );
  await rejected(
    player.intent('entity.update', {
      sceneId: SCENE,
      entityId: DOOR,
      changes: { wall: { points: segment, door: { open: true } } },
    }),
  );
  await rejected(player.intent('entity.delete', { sceneId: SCENE, entityId: DOOR }));
  await rejected(
    player.intent('entity.update', { sceneId: SCENE, entityId: FOG, changes: { name: 'x' } }),
  );
  await rejected(player.intent('entity.delete', { sceneId: SCENE, entityId: FOG }));
  // Without the Doors tool, no door at all.
  const setDoor = (entityId: string, open: boolean) =>
    player.intent('wall.setDoor', { sceneId: SCENE, entityId, open });
  await rejected(setDoor(DOOR, true));
  await rejected(setDoor(SECRET, true));

  // --- the DM grants Doors: open and close a normal door --------------------------------------------
  await ok(host.intent('seat.update', { seatId: SEAT, tools: { doors: true } }));
  await settle([player]);
  await ok(setDoor(DOOR, true));
  await settle([player, spectator]);
  expect(wallOf(spectator, DOOR)).toEqual({ points: segment, door: { open: true } });
  await ok(setDoor(DOOR, false));
  // A secret door stays out of reach even with the tool, and its rejection is word for word the one
  // for a plain wall, a non-wall entity and an unknown id, so it reveals nothing.
  const reasons = await Promise.all(
    [SECRET, PLAIN_WALL, CRATE, testUlid('NOSUCH', 1)].map(async (id) => {
      const r = await setDoor(id, true);
      expect(r, JSON.stringify(r)).toMatchObject({ t: 'reject' });
      return r.reason;
    }),
  );
  expect(new Set(reasons).size, JSON.stringify(reasons)).toBe(1);
  await settle([player, spectator]);
  expect(wallOf(player, DOOR)).toEqual({ points: segment, door: { open: false } });

  // --- closed window 1: everything so far, plus a fresh reconnect --------------------------------
  const mark = () => [player.frames.length, spectator.frames.length] as const;
  expectNoClosedSecretDoor(player.frames, 'player');
  expectNoClosedSecretDoor(spectator.frames, 'spectator');
  allFrames.push({ who: 'player', frames: player.frames });
  await player.close();
  player = await RawClient.connect(table, {
    name: 'player-reconnected',
    identityId: PLAYER_ID,
    identitySecret: 'player-secret',
  });
  await player.waitForSeq(host.lastSeq);
  expect(wallOf(player, SECRET)).toEqual({ points: segment });
  expectNoClosedSecretDoor(player.frames, 'player after reconnect');

  // --- the DM opens it: an ordinary open door, never `secret` -----------------------------------
  await ok(host.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, open: true }));
  await settle([player, spectator]);
  for (const c of [player, spectator])
    expect(wallOf(c, SECRET)).toEqual({ points: segment, door: { open: true } });

  // --- the DM closes it, renames it and reveals the region: plain wall, blank names ------------
  await ok(host.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, open: false }));
  const [playerMark, spectatorMark] = mark();
  const keptSeq = spectator.lastSeq;
  const keptState = structuredClone(spectator.state);
  await ok(
    host.intent('entity.update', { sceneId: SCENE, entityId: SECRET, changes: { name: 'Lever' } }),
  );
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: FOG,
      changes: { name: 'Throne room', fogRegion: { points: region, revealed: true } },
    }),
  );
  await settle([player, spectator]);
  for (const c of [player, spectator]) expect(wallOf(c, SECRET)).toEqual({ points: segment });
  expectNoClosedSecretDoor(player.frames.slice(playerMark), 'player after close');
  expectNoClosedSecretDoor(spectator.frames.slice(spectatorMark), 'spectator after close');

  for (const c of [player, spectator]) {
    expect(entityOf(c, FOG)?.fogRegion).toEqual({ points: region, revealed: true });
    expect(entityOf(c, FOG)?.name).toBe('');
  }

  // Reconnects while it is closed: a fresh snapshot and a replay from before the rename.
  await player.close();
  const fresh = await RawClient.connect(table, {
    name: 'player-fresh',
    identityId: PLAYER_ID,
    identitySecret: 'player-secret',
  });
  const replay = await RawClient.connect(table, {
    name: 'spectator-replay',
    identityId: SPECTATOR_ID,
    identitySecret: 'spectator-secret',
    lastSeq: keptSeq,
    initialState: keptState,
  });
  await fresh.waitForSeq(host.lastSeq);
  await replay.waitForSeq(host.lastSeq);
  for (const c of [fresh, replay]) {
    expect(wallOf(c, SECRET)).toEqual({ points: segment });
    expectNoClosedSecretDoor(c.frames, c.opts.name);
  }
  allFrames.push(
    { who: 'player-reconnected', frames: player.frames },
    { who: 'spectator', frames: spectator.frames },
    { who: 'player-fresh', frames: fresh.frames },
    { who: 'spectator-replay', frames: replay.frames },
  );

  // --- over every frame any player or spectator socket received ---------------------------------
  for (const { who, frames } of allFrames) {
    for (const needle of ['"secret"', ...NAMES])
      expect(
        frames.filter((f) => f.includes(needle)),
        `${who}: ${needle} leaked`,
      ).toEqual([]);
    // Detector control: every socket that got a snapshot did receive the wall and the region. (The
    // replay gets only post-close patches: the region reveal, and nothing for the renamed wall.)
    if (frames.some((f) => f.includes('"t":"snapshot"')))
      for (const id of [SECRET, FOG])
        expect(
          frames.some((f) => f.includes(id)),
          `${who}: saw ${id}`,
        ).toBe(true);
  }
  expect(replay.frames.some((f) => f.includes('"t":"snapshot"'))).toBe(false);
  expect(replay.frames.some((f) => f.includes('"revealed"'))).toBe(true);
  // Positive control: the host's unfiltered socket did receive all of it.
  for (const needle of ['"secret"', ...NAMES])
    expect(
      host.frames.some((f) => f.includes(needle)),
      needle,
    ).toBe(true);

  await Promise.all([fresh.close(), replay.close(), spectator.close()]);
});
