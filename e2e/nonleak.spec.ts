import { expect, test } from '@playwright/test';
import {
  RawClient,
  recordPageFrames,
  startTable,
  testUlid,
  type Reply,
  type Table,
} from './harness.js';

// M1-22 (PERM-03, LAY-04): nothing on the DM layer may ever reach a player or spectator socket,
// not in a snapshot, a live patch or a reconnect replay, including across layer moves. Frames are
// captured raw at the transport level and searched as plain text, so the check does not depend
// on how the app parses or renders them.

type EntityLayer = 'map' | 'props' | 'tokens' | 'dm' | 'effects';

interface Secret {
  id: string;
  name: string;
  imageHash: string;
  pinText: string;
}

let table: Table;
let host: RawClient;
const SCENE = testUlid('SCENE', 1);
const SEAT = testUlid('SEAT', 1);
const PLAYER_ID = testUlid('PLAYER', 1);
const SPECTATOR_ID = testUlid('SPECT', 1);

const secretFor = (n: number): Secret => ({
  id: testUlid('SECRETENT', n),
  name: `Arch-Lich Vorgrath the Hidden ${String(n)}`,
  imageHash: String(n).padStart(64, 'a'),
  pinText: `The vault key is under the third flagstone ${String(n)}`,
});

function entityFor(s: Secret, layer: EntityLayer) {
  const one = { x: 1, y: 1, z: 1 };
  return {
    id: s.id,
    layer,
    name: s.name,
    owners: [],
    transform: { position: { x: 2, y: 0, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: one },
    token: {
      sizeCells: 1,
      heightCells: 1,
      labelVisibility: 'all',
      image: { source: 'local', hash: s.imageHash, kind: 'image' },
    },
    pin: { text: s.pinText, reveal: 'click' },
  };
}

/** Everything that identifies a secret entity or carries its data. */
const needles = (s: Secret): string[] => [s.id, s.name, s.imageHash, s.pinText];

const leaksIn = (frames: readonly string[], strings: readonly string[]): string[] =>
  frames.filter((f) => strings.some((x) => f.includes(x)));

async function ok(reply: Promise<Reply>): Promise<number> {
  const r = await reply;
  expect(r, JSON.stringify(r)).toMatchObject({ t: 'ack' });
  return r.seq ?? -1;
}

const connectPlayer = (lastSeq?: number, initialState?: unknown) =>
  RawClient.connect(table, {
    name: 'player',
    identityId: PLAYER_ID,
    identitySecret: 'player-secret',
    ...(lastSeq !== undefined ? { lastSeq } : {}),
    ...(initialState !== undefined ? { initialState } : {}),
  });
const connectSpectator = () =>
  RawClient.connect(table, {
    name: 'spectator',
    identityId: SPECTATOR_ID,
    identitySecret: 'spectator-secret',
  });

/** True when the client's mirrored state has the entity in the scene, and with what layer. */
function seen(c: RawClient, id: string): Record<string, unknown> | undefined {
  const state = c.state as
    { scenes?: Record<string, { entities?: Record<string, unknown> }> } | undefined;
  return state?.scenes?.[SCENE]?.entities?.[id] as Record<string, unknown> | undefined;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'host',
    identityId: testUlid('HOST', 1),
    identitySecret: 'host-secret',
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('DM-layer data never reaches players or spectators, across layer moves, edits, deletes and reconnects', async () => {
  const visible = secretFor(0); // a normal token everyone may see throughout
  const h1 = secretFor(1); // dm -> tokens -> dm -> edited -> deleted
  const h2 = secretFor(2); // dm -> deleted without ever being visible
  const h3 = secretFor(3); // tokens -> dm -> edited -> deleted

  // --- setup: scene, seat, one visible token ---------------------------------------------------
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Crypt' }));
  await ok(host.intent('seat.create', { seatId: SEAT, label: 'Rogue' }));
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: entityFor(visible, 'tokens') }));

  // The player sits down; the spectator stays unseated. A third socket will reconnect.
  let player = await connectPlayer();
  const spectator = await connectSpectator();
  await Promise.all([player.waitFor('snapshot', () => player.state !== undefined)]);
  await spectator.waitFor('snapshot', () => spectator.state !== undefined);
  player.join(SEAT);
  await player.waitFor('seated', () => {
    const seats = (player.state as { seats?: Record<string, { identityId: string | null }> }).seats;
    return seats?.[SEAT]?.identityId === PLAYER_ID;
  });
  await host.waitForSeq(player.lastSeq);
  const hostSeq = () => host.lastSeq;
  const settle = async (clients: RawClient[]) => {
    const target = hostSeq();
    await Promise.all(clients.map((c) => c.waitForSeq(target)));
  };
  await settle([player, spectator]);
  expect(seen(player, visible.id)).toBeDefined();
  expect(seen(spectator, visible.id)).toBeDefined();

  // A late reconnect baseline, taken while only `visible` exists.
  const reconnectSeq = player.lastSeq;
  const keptState = player.state;
  await player.close();

  const all = [h1, h2, h3].flatMap(needles);
  const audience = () => [spectator, player];

  // --- hidden creation (seq advances for everyone, no content) --------------------------------
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: entityFor(h1, 'dm') }));
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: entityFor(h2, 'dm') }));
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: entityFor(h3, 'tokens') }));
  await spectator.waitForSeq(hostSeq());
  expect(seen(spectator, h1.id)).toBeUndefined();
  expect(seen(spectator, h2.id)).toBeUndefined();
  expect(seen(spectator, h3.id)).toBeDefined(); // visible so far

  // Player reconnects with lastSeq: this takes the replay path (patches missed while away).
  player = await connectPlayer(reconnectSeq, keptState);
  await player.waitForSeq(hostSeq());
  expect(player.frames.some((f) => f.includes('"t":"patch"'))).toBe(true);
  expect(player.frames.some((f) => f.includes('"t":"snapshot"'))).toBe(false);
  expect(seen(player, h1.id)).toBeUndefined();
  expect(seen(player, h3.id)).toBeDefined();

  // --- moves on and off the DM layer ----------------------------------------------------------
  await ok(host.intent('entity.setLayer', { sceneId: SCENE, entityId: h3.id, layer: 'dm' }));
  await settle([player, spectator]);
  for (const c of [player, spectator]) {
    expect(seen(c, h3.id), `${c.opts.name} still sees h3 on dm layer`).toBeUndefined();
  }
  // From the frame that removes h3 onward the audience may not receive any of its data again.
  const markAfterH3Hidden = [player.frames.length, spectator.frames.length];

  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: h3.id,
      changes: { name: 'SECRET-RENAMED-H3' },
    }),
  );
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: h1.id,
      changes: { name: 'SECRET-RENAMED-H1', pin: { text: 'SECRET-NEW-PIN', reveal: 'hover' } },
    }),
  );
  await ok(host.intent('entity.delete', { sceneId: SCENE, entityId: h2.id }));
  await settle([player, spectator]);

  // h1 becomes visible: both audiences now see it, with its data (positive control).
  await ok(host.intent('entity.setLayer', { sceneId: SCENE, entityId: h1.id, layer: 'tokens' }));
  await settle([player, spectator]);
  for (const c of audience()) {
    const e = seen(c, h1.id);
    expect(e, `${c.opts.name} should see h1 once on tokens`).toBeDefined();
    expect(e?.['layer']).toBe('tokens');
    expect(e?.['name']).toBe('SECRET-RENAMED-H1');
  }

  // ...and hidden again: gone, with no residual data in later frames or in the mirrored state.
  await ok(host.intent('entity.setLayer', { sceneId: SCENE, entityId: h1.id, layer: 'dm' }));
  await settle([player, spectator]);
  for (const c of audience()) expect(seen(c, h1.id)).toBeUndefined();
  const markAfterH1Hidden = [player.frames.length, spectator.frames.length];
  const tailSeq = spectator.lastSeq;
  const tailState = structuredClone(spectator.state);

  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: h1.id,
      changes: {
        name: 'SECRET-AFTER-HIDE',
        pin: { text: 'SECRET-PIN-AFTER-HIDE', reveal: 'click' },
      },
    }),
  );
  await ok(host.intent('entity.delete', { sceneId: SCENE, entityId: h1.id }));
  await ok(host.intent('entity.delete', { sceneId: SCENE, entityId: h3.id }));
  await settle([player, spectator]);

  // --- the player reconnects again without lastSeq: the snapshot path --------------------------
  await player.close();
  const snapPlayer = await connectPlayer();
  await snapPlayer.waitForSeq(hostSeq());
  expect(snapPlayer.frames[0]).toContain('"t":"snapshot"');
  expect(seen(snapPlayer, visible.id)).toBeDefined();
  for (const id of [h1.id, h2.id, h3.id]) expect(seen(snapPlayer, id)).toBeUndefined();
  // Replay path for a spectator that missed only the post-hide edits and deletes: those frames
  // carry no entity content for this audience at all.
  const staleSpectator = await RawClient.connect(table, {
    name: 'spectator-2',
    identityId: SPECTATOR_ID,
    identitySecret: 'spectator-secret',
    lastSeq: tailSeq,
    initialState: tailState,
  });
  await staleSpectator.waitForSeq(hostSeq());
  for (const id of [h1.id, h2.id, h3.id]) expect(seen(staleSpectator, id)).toBeUndefined();

  // --- assertions over every raw frame ---------------------------------------------------------
  // h2 never left the DM layer: not a single byte of it, anywhere, ever.
  const neverVisible = needles(h2);
  // h1 and h3 were visible for a window, so earlier frames may legitimately carry them. What must
  // hold is that after being hidden, only the bare removal (which names the id the client already
  // had) may mention them, and nothing from edits made while hidden appears at all.
  const editedWhileHidden = ['SECRET-RENAMED-H3', 'SECRET-AFTER-HIDE', 'SECRET-PIN-AFTER-HIDE'];
  const everyone = [player, snapPlayer, spectator, staleSpectator];
  for (const c of everyone) {
    expect(leaksIn(c.frames, neverVisible), `${c.opts.name}: h2 leaked`).toEqual([]);
    expect(
      leaksIn(c.frames, editedWhileHidden),
      `${c.opts.name}: edit while hidden leaked`,
    ).toEqual([]);
  }
  // The fresh-snapshot and replay-from-stale views are wholly clean of all hidden-entity data.
  for (const c of [snapPlayer, staleSpectator]) expect(leaksIn(c.frames, all)).toEqual([]);
  // After h3 went to dm: frames never carry h3's name/image/pin again; only its id in the removal.
  for (const [i, c] of [player, spectator].entries()) {
    const later = c.frames.slice(markAfterH3Hidden[i]);
    expect(leaksIn(later, [h3.name, h3.imageHash, h3.pinText]), c.opts.name).toEqual([]);
    for (const f of leaksIn(later, [h3.id])) {
      expect(f, `${c.opts.name}: h3 id may only appear in a removal`).toContain('"op":"remove"');
    }
    // After h1 was hidden again, the same holds for h1.
    const laterH1 = c.frames.slice(i === 0 ? markAfterH1Hidden[0] : markAfterH1Hidden[1]);
    expect(leaksIn(laterH1, [h1.name, h1.imageHash, h1.pinText, 'SECRET-RENAMED-H1'])).toEqual([]);
    for (const f of leaksIn(laterH1, [h1.id])) expect(f).toContain('"op":"remove"');
  }
  // Before h1 was ever shown, no frame mentions it: scan the frames up to the reveal.
  for (const c of [spectator]) {
    const firstH1 = c.frames.findIndex((f) => f.includes(h1.id));
    const firstVisibleH1 = c.frames.findIndex((f) => f.includes('"op":"add"') && f.includes(h1.id));
    expect(firstH1).toBe(firstVisibleH1);
  }
  // The visible token was shown the whole time.
  expect(leaksIn(snapPlayer.frames, needles(visible)).length).toBeGreaterThan(0);
  expect(staleSpectator.frames.some((f) => f.includes('"t":"patch"'))).toBe(true);
  expect(staleSpectator.frames.some((f) => f.includes('"t":"snapshot"'))).toBe(false);

  // Positive control for the detector: the host (unfiltered) did receive everything.
  expect(leaksIn(host.frames, all).length).toBeGreaterThan(0);
  expect(leaksIn(host.frames, [h2.name, h2.id, h2.pinText])).not.toEqual([]);

  await Promise.all([
    snapPlayer.close(),
    staleSpectator.close(),
    spectator.close(),
    player.close(),
  ]);
});

test('a hidden token label name never reaches players or spectators, across renames and flips (D35)', async () => {
  const s = secretFor(21);
  const token = (labelVisibility: string) => ({
    sizeCells: 1,
    heightCells: 1,
    labelVisibility,
  });
  const ent = { ...entityFor(s, 'tokens'), token: token('dm'), pin: undefined };
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: ent }));

  const player = await connectPlayer();
  const spectator = await connectSpectator();
  await player.waitFor('snapshot', () => player.state !== undefined);
  await spectator.waitFor('snapshot', () => spectator.state !== undefined);
  const watchers = [player, spectator];
  const settle = async () => {
    const target = host.lastSeq;
    await Promise.all(watchers.map((c) => c.waitForSeq(target)));
  };
  const nameOf = (c: RawClient) => seen(c, s.id)?.['name'];

  // The token is visible to everyone, but its name is not on the wire (snapshot path).
  for (const c of watchers) {
    expect(seen(c, s.id), c.opts.name).toBeDefined();
    expect(nameOf(c)).toBe('');
    expect(leaksIn(c.frames, [s.name]), c.opts.name).toEqual([]);
  }

  // Rename while hidden (patch path).
  const renamed = 'SECRET-LABEL-RENAMED';
  await ok(
    host.intent('entity.update', { sceneId: SCENE, entityId: s.id, changes: { name: renamed } }),
  );
  await settle();
  for (const c of watchers) expect(leaksIn(c.frames, [s.name, renamed]), c.opts.name).toEqual([]);

  // Reveal to everyone: now the name is delivered (positive control), and it hides again.
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: s.id,
      changes: { token: token('all') },
    }),
  );
  await settle();
  for (const c of watchers) expect(nameOf(c), c.opts.name).toBe(renamed);
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: s.id,
      changes: { token: token('owner') },
    }),
  );
  await settle();
  for (const c of watchers) expect(nameOf(c), c.opts.name).toBe('');
  const mark = watchers.map((c) => c.frames.length);

  // Renames after re-hiding must not appear in any later frame.
  const lateName = 'SECRET-LABEL-AFTER-HIDE';
  await ok(
    host.intent('entity.update', { sceneId: SCENE, entityId: s.id, changes: { name: lateName } }),
  );
  await settle();
  for (const [i, c] of watchers.entries()) {
    expect(leaksIn(c.frames.slice(mark[i]), [renamed, lateName, s.name]), c.opts.name).toEqual([]);
  }

  // A fresh snapshot is clean too.
  const fresh = await connectPlayer();
  await fresh.waitForSeq(host.lastSeq);
  expect(leaksIn(fresh.frames, [s.name, renamed, lateName])).toEqual([]);
  expect(seen(fresh, s.id)).toBeDefined();

  // Positive control: the host receives every name.
  expect(leaksIn(host.frames, [lateName]).length).toBeGreaterThan(0);

  await Promise.all([fresh.close(), player.close(), spectator.close()]);
});

test('a real browser client (spectator) never receives DM-layer frames either', async ({
  browser,
}) => {
  const secret = secretFor(7);
  const context = await browser.newContext();
  const page = await context.newPage();
  const frames = recordPageFrames(page);
  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toContainText('Connected');
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: entityFor(secret, 'dm') }));
  const seqBefore = host.lastSeq;
  await expect.poll(() => frames.some((f) => f.includes(`"seq":${String(seqBefore)}`))).toBe(true);
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: secret.id,
      changes: { name: 'SECRET-BROWSER-EDIT' },
    }),
  );
  await ok(host.intent('entity.delete', { sceneId: SCENE, entityId: secret.id }));
  const seqAfter = host.lastSeq;
  await expect.poll(() => frames.some((f) => f.includes(`"seq":${String(seqAfter)}`))).toBe(true);
  expect(frames.length).toBeGreaterThan(0);
  expect(leaksIn(frames, [...needles(secret), 'SECRET-BROWSER-EDIT'])).toEqual([]);
  await context.close();
});
