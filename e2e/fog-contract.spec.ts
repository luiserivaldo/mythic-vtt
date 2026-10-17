import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// FOG-01 (MV-295; D47 as amended by MV-303) / PERM-03: the vision contract over the wire. A closed
// secret door reaches players and spectators only as a plain wall, an open one only as an ordinary
// open door, and the `secret` flag never at all; a DM fog region never reaches them; walls and
// sight blocking are DM data; and doors open for a player only with the per-seat `doors` tool.
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

const transform = (x: number, z: number) => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});
const segment = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
];
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

/** While the secret door is closed or locked, a frame may only take away an already-open door. */
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

test('secret doors, fog regions and DM-only vision data never reach players or spectators', async () => {
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
      wall: { points: segment, door: { state: 'closed', secret: true } },
    }),
  );
  await ok(
    create({
      ...base(DOOR, 'map', 'Vestry door', 4),
      wall: { points: segment, door: { state: 'closed' } },
    }),
  );
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
      ...base(FOG, 'dm', 'Unexplored crypt', 10),
      fogRegion: {
        points: [
          { x: 0, z: 0 },
          { x: 4, z: 0 },
          { x: 4, z: 3 },
          { x: 0, z: 3 },
        ],
        hidden: true,
      },
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

  // Players see the switch and walls (D47 (4)), the secret door as a plain wall.
  for (const c of [player, spectator]) {
    expect(wallOf(c, SECRET)).toEqual({ points: segment });
    expect(wallOf(c, DOOR)).toEqual({ points: segment, door: { state: 'closed' } });
    expect(
      (c.state as { scenes: Record<string, { vision?: unknown }> }).scenes[SCENE]?.vision,
    ).toEqual({ dynamicLighting: true });
  }
  expect(wallOf(host, SECRET)).toEqual({
    points: segment,
    door: { state: 'closed', secret: true },
  });

  // --- the player's raw intents: walls, sight blocking and doors are DM data ----------------------
  await rejected(
    player.intent('entity.create', {
      sceneId: SCENE,
      entity: { ...base(RAW_WALL, 'map', 'My wall', 12), wall: { points: segment } },
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
      changes: { wall: { points: segment, door: { state: 'open' } } },
    }),
  );
  await rejected(player.intent('entity.delete', { sceneId: SCENE, entityId: DOOR }));
  // MV-303 Q1: without the doors tool, no door at all.
  await rejected(player.intent('wall.setDoor', { sceneId: SCENE, entityId: DOOR, state: 'open' }));
  await rejected(
    player.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, state: 'open' }),
  );

  // --- the DM grants the doors tool: open and close a normal door, never lock it ------------------
  await ok(host.intent('seat.update', { seatId: SEAT, tools: { doors: true } }));
  await settle([player]);
  await ok(player.intent('wall.setDoor', { sceneId: SCENE, entityId: DOOR, state: 'open' }));
  await settle([player, spectator]);
  expect(wallOf(spectator, DOOR)).toEqual({ points: segment, door: { state: 'open' } });
  await ok(player.intent('wall.setDoor', { sceneId: SCENE, entityId: DOOR, state: 'closed' }));
  await rejected(
    player.intent('wall.setDoor', { sceneId: SCENE, entityId: DOOR, state: 'locked' }),
  );
  // A secret door stays out of reach even with the tool.
  await rejected(
    player.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, state: 'open' }),
  );
  await settle([player, spectator]);
  expect(wallOf(player, DOOR)).toEqual({ points: segment, door: { state: 'closed' } });

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
  await ok(host.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, state: 'open' }));
  await settle([player, spectator]);
  for (const c of [player, spectator])
    expect(wallOf(c, SECRET)).toEqual({ points: segment, door: { state: 'open' } });

  // --- the DM closes and locks it: back to a plain wall -----------------------------------------
  await ok(host.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, state: 'closed' }));
  const [playerMark, spectatorMark] = mark();
  const keptSeq = spectator.lastSeq;
  const keptState = structuredClone(spectator.state);
  await ok(host.intent('wall.setDoor', { sceneId: SCENE, entityId: SECRET, state: 'locked' }));
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: FOG,
      changes: {
        fogRegion: {
          points: [
            { x: 0, z: 0 },
            { x: 4, z: 0 },
            { x: 4, z: 3 },
          ],
          hidden: false,
        },
      },
    }),
  );
  await settle([player, spectator]);
  for (const c of [player, spectator]) expect(wallOf(c, SECRET)).toEqual({ points: segment });
  expectNoClosedSecretDoor(player.frames.slice(playerMark), 'player after close');
  expectNoClosedSecretDoor(spectator.frames.slice(spectatorMark), 'spectator after close');

  // Reconnects while it is locked: a fresh snapshot and a replay from before the lock.
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
    for (const needle of ['"secret"', FOG, '"fogRegion"', 'Unexplored crypt'])
      expect(
        frames.filter((f) => f.includes(needle)),
        `${who}: ${needle} leaked`,
      ).toEqual([]);
    // Detector control: every socket that got a snapshot did receive the wall itself. (The replay
    // gets only post-lock patches, and locking a closed secret door changes nothing it may see.)
    if (frames.some((f) => f.includes('"t":"snapshot"')))
      expect(
        frames.some((f) => f.includes(SECRET)),
        `${who}: saw the wall`,
      ).toBe(true);
  }
  expect(replay.frames.some((f) => f.includes('"t":"snapshot"'))).toBe(false);
  // Positive control: the host's unfiltered socket did receive all of it.
  for (const needle of ['"secret"', FOG, '"fogRegion"'])
    expect(
      host.frames.some((f) => f.includes(needle)),
      needle,
    ).toBe(true);

  await Promise.all([fresh.close(), replay.close(), spectator.close()]);
});
