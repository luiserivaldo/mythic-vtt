import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import { storeMigrate, type Campaign } from '@mythic/shared';
import { loadConfig, type HostConfig } from './config.js';
import { SECRETS, T, fixtureCampaign, tid } from './engine/testing.js';
import { startHost, type RunningHost } from './server.js';
import { CampaignFile, LocalCampaignStore } from './storage/index.js';

type Of<K extends ServerMessage['t']> = Extract<ServerMessage, { t: K }>;

const HOST_ID = tid(21);
const PLAYER_ID = T.alice; // seated in seat A by the fixture
const GUEST_ID = tid(22);
const RIVAL_ID = tid(23);

/** A real `ws` client speaking the protocol, recording every raw frame. */
interface WireClient {
  readonly frames: string[];
  readonly messages: ServerMessage[];
  send(m: ClientMessage): void;
  waitFor<K extends ServerMessage['t']>(
    t: K,
    pred?: (m: Of<K>) => boolean,
    timeoutMs?: number,
  ): Promise<Of<K>>;
  close(): Promise<void>;
}

let dir: string;
let config: HostConfig;
let host: RunningHost | undefined;
const clients: WireClient[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-engine-'));
  config = loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir });
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await host?.close();
  host = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** Seeds the data dir with the fixture campaign (it holds a DM-layer entity). */
async function seed(campaign: Campaign = fixtureCampaign()): Promise<void> {
  const store = new LocalCampaignStore(dir, storeMigrate);
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.close();
}

async function connect(
  identityId: string,
  opts: { hostToken?: string; lastSeq?: number; displayName?: string } = {},
): Promise<WireClient> {
  if (!host) throw new Error('host not started');
  const ws = new WebSocket(`ws://127.0.0.1:${String(host.port)}/ws`);
  const frames: string[] = [];
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  ws.on('message', (data: Buffer) => {
    const raw = data.toString();
    frames.push(raw);
    messages.push(JSON.parse(raw) as ServerMessage);
    for (const l of listeners) l();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      resolve();
    });
    ws.once('error', reject);
  });
  const client: WireClient = {
    frames,
    messages,
    send: (m) => {
      ws.send(JSON.stringify(m));
    },
    waitFor(t, pred = () => true, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const hit = messages.find((m): m is Of<typeof t> => m.t === t && pred(m as Of<typeof t>));
          if (hit) {
            listeners.delete(check);
            clearTimeout(timer);
            resolve(hit);
          }
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`timed out waiting for ${t}; got ${JSON.stringify(messages)}`));
        }, timeoutMs);
        listeners.add(check);
        check();
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.once('close', () => {
          resolve();
        });
        ws.close();
      }),
  };
  clients.push(client);
  client.send({
    t: 'hello',
    v: PROTOCOL_VERSION,
    identityId,
    identitySecret: `secret-${identityId}`,
    displayName: opts.displayName ?? 'Tester',
    ...(opts.hostToken !== undefined ? { hostToken: opts.hostToken } : {}),
    ...(opts.lastSeq !== undefined ? { lastSeq: opts.lastSeq } : {}),
  });
  return client;
}

async function start(): Promise<RunningHost> {
  host = await startHost(config, { hostToken: 'test-host-token' });
  return host;
}

const rename = (name: string, clientRef: string): ClientMessage => ({
  t: 'intent',
  type: 'scene.rename',
  payload: { sceneId: T.scene, name },
  clientRef,
});

describe('startHost with the engine', () => {
  it('creates and persists a new campaign on first run and serves it as a snapshot', async () => {
    await start();
    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    const snap = await dm.waitFor('snapshot');
    expect(snap).toMatchObject({ seq: 0, seatId: null });
    const state = snap.state as Campaign;
    expect(state.name).toBe('New campaign');
    const id = host?.engine.campaignId;
    await host?.close();
    host = undefined;

    // A restart opens the same campaign, and the host binding survived (no token needed).
    const restarted = await start();
    expect(restarted.engine.campaignId).toBe(id);
    const again = await connect(HOST_ID);
    await again.waitFor('snapshot');
    again.send({
      t: 'intent',
      type: 'scene.create',
      payload: { sceneId: T.newScene, name: 'Hall' },
      clientRef: 'c',
    });
    expect(await again.waitFor('ack')).toEqual({ t: 'ack', clientRef: 'c', seq: 1 });
  });

  it('acks the sender, patches the others, rejects bad intents and keeps seq monotonic', async () => {
    await seed();
    await start();
    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    const player = await connect(PLAYER_ID);
    await dm.waitFor('snapshot');
    expect((await player.waitFor('snapshot')).seatId).toBe(T.seatA);

    dm.send(rename('Lair', 'r1'));
    expect(await dm.waitFor('ack', (m) => m.clientRef === 'r1')).toMatchObject({ seq: 1 });
    expect(await dm.waitFor('patch', (m) => m.seq === 1)).toMatchObject({ clientRef: 'r1' });
    const seen = await player.waitFor('patch', (m) => m.seq === 1);
    expect(seen).toEqual({
      t: 'patch',
      seq: 1,
      patches: [{ op: 'replace', path: ['scenes', T.scene, 'name'], value: 'Lair' }],
    });

    player.send(rename('Mine', 'p1'));
    expect(await player.waitFor('reject', (m) => m.clientRef === 'p1')).toMatchObject({
      reason: 'forbidden',
    });
    dm.send({ t: 'intent', type: 'scene.rename', payload: { name: 3 }, clientRef: 'bad' });
    expect(await dm.waitFor('reject', (m) => m.clientRef === 'bad')).toMatchObject({
      reason: 'invalid-payload',
    });
    dm.send({ t: 'intent', type: 'no.such', payload: {}, clientRef: 'nope' });
    expect(await dm.waitFor('reject', (m) => m.clientRef === 'nope')).toMatchObject({
      reason: 'unknown-action',
    });

    for (let i = 2; i <= 6; i++) dm.send(rename(`N${String(i)}`, `r${String(i)}`));
    await dm.waitFor('ack', (m) => m.clientRef === 'r6');
    await player.waitFor('patch', (m) => m.seq === 6);
    const acks = dm.messages.filter((m): m is Of<'ack'> => m.t === 'ack').map((m) => m.seq);
    expect(acks).toEqual([1, 2, 3, 4, 5, 6]);
    const playerSeqs = player.messages
      .filter((m): m is Of<'patch'> => m.t === 'patch')
      .map((m) => m.seq);
    expect(playerSeqs).toEqual([1, 2, 3, 4, 5, 6]);

    // Every applied action is in this session's log, in seq order.
    await host?.close();
    host = undefined;
    const sessions = join(dir, 'campaigns', T.campaign, 'sessions');
    const [session] = await readdir(sessions);
    const lines = (await readFile(join(sessions, session ?? '', 'log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { envelope: { seq: number; actor: { kind: string } } });
    expect(lines.map((l) => l.envelope.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lines[0]?.envelope.actor.kind).toBe('host');
  });

  it('a guest joins a free seat and switches to that seat view', async () => {
    await seed();
    await start();
    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    const guest = await connect(GUEST_ID);
    await dm.waitFor('snapshot');
    expect((await guest.waitFor('snapshot')).seatId).toBeNull();
    guest.send({ t: 'join', seatId: T.seatB });
    const seated = await guest.waitFor('snapshot', (m) => m.seatId === T.seatB);
    expect(seated.seq).toBe(1);
    await dm.waitFor('patch', (m) => m.seq === 1);
    expect(guest.messages.some((m) => m.t === 'presence')).toBe(false);
    expect(guest.frames.join('\n')).not.toContain('SECRET-DM');

    await guest.close();
    const back = await connect(GUEST_ID, { lastSeq: 1 });
    expect(await back.waitFor('snapshot')).toMatchObject({ seq: 1, seatId: T.seatB });
    expect(back.frames.join('\n')).not.toContain('SECRET-DM');

    const rival = await connect(RIVAL_ID);
    await rival.waitFor('snapshot');
    rival.send({ t: 'join', seatId: T.seatB });
    expect(await rival.waitFor('error')).toMatchObject({
      code: 'seat-unavailable',
      fatal: false,
    });
  });

  it('shows the DM who is connected but unseated, and nobody else (M1-11, PERM-03)', async () => {
    await seed();
    await start();
    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    const guest = await connect(GUEST_ID, { displayName: 'Guesty' });
    const player = await connect(PLAYER_ID, { displayName: 'Alicia' });
    await Promise.all([
      dm.waitFor('snapshot'),
      guest.waitFor('snapshot'),
      player.waitFor('snapshot'),
    ]);

    const roster = await dm.waitFor(
      'presence',
      (m) =>
        (m.unseated ?? []).length === 1 && m.seats.some((x) => x.seatId === T.seatA && x.connected),
    );
    expect(roster.unseated).toEqual([{ identityId: GUEST_ID, displayName: 'Guesty' }]);
    expect(roster.seats.find((s) => s.seatId === T.seatA)).toMatchObject({
      displayName: 'Alicia',
      connected: true,
    });

    // The DM seats the guest from the roster; the entry disappears.
    dm.send({
      t: 'intent',
      type: 'seat.assign',
      payload: { seatId: T.seatB, identityId: GUEST_ID },
      clientRef: 'assign-1',
    });
    await dm.waitFor('presence', (m) => (m.unseated ?? []).length === 0 && m.seats.length > 0);

    // Players and spectators never receive a roster or each other's identity ids.
    await guest.waitFor('snapshot', (m) => m.seatId === T.seatB);
    for (const c of [guest, player]) {
      expect(c.messages.some((m) => m.t === 'presence')).toBe(false);
      expect(c.frames.join('\n')).not.toContain('unseated');
    }
    // (Seat bindings in the state already carry identity ids; the roster adds names, which stay host-only.)
    expect(player.frames.join('\n')).not.toContain('Guesty');
  });

  it('clears per-session bindings, but not persistent bindings, when the Session ends', async () => {
    const campaign = fixtureCampaign();
    const sessionSeat = campaign.seats[T.seatB];
    if (sessionSeat) sessionSeat.binding = 'session';
    await seed(campaign);
    await start();
    const guest = await connect(GUEST_ID);
    await guest.waitFor('snapshot');
    guest.send({ t: 'join', seatId: T.seatB });
    await guest.waitFor('snapshot', (m) => m.seatId === T.seatB);

    await host?.close();
    host = undefined;

    const sessions = join(dir, 'campaigns', T.campaign, 'sessions');
    const [session] = await readdir(sessions);
    const lines = (await readFile(join(sessions, session ?? '', 'log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            envelope: { type: string; payload: { seatId?: string } };
          },
      );
    expect(lines.map((line) => line.envelope.type)).toEqual(['session.join', 'seat.release']);
    expect(lines[1]?.envelope.payload).toEqual({ seatId: T.seatB });
    expect(lines.some((line) => line.envelope.payload.seatId === T.seatA)).toBe(false);
  });

  it('replays missed patches on reconnect, else falls back to a snapshot', async () => {
    await seed();
    await start();
    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    await dm.waitFor('snapshot');
    const player = await connect(PLAYER_ID);
    await player.waitFor('snapshot');
    dm.send(rename('One', 'r1'));
    await player.waitFor('patch', (m) => m.seq === 1);
    await player.close();

    dm.send(rename('Two', 'r2'));
    dm.send(rename('Three', 'r3'));
    await dm.waitFor('ack', (m) => m.clientRef === 'r3');

    const back = await connect(PLAYER_ID, { lastSeq: 1 });
    await back.waitFor('patch', (m) => m.seq === 3);
    expect(back.messages.map((m) => [m.t, 'seq' in m ? m.seq : null])).toEqual([
      ['patch', 2],
      ['patch', 3],
    ]);

    // Up to date, or a seq this host never issued: a fresh snapshot.
    const current = await connect(PLAYER_ID, { lastSeq: 3 });
    expect(await current.waitFor('snapshot')).toMatchObject({ seq: 3, seatId: T.seatA });
    const future = await connect(PLAYER_ID, { lastSeq: 50 });
    expect(await future.waitFor('snapshot')).toMatchObject({ seq: 3 });
  });

  it('never sends DM-layer data to player or spectator sockets (PERM-03)', async () => {
    await seed();
    await start();
    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    const player = await connect(PLAYER_ID);
    const spectator = await connect(GUEST_ID);
    await dm.waitFor('snapshot');
    await player.waitFor('snapshot');
    await spectator.waitFor('snapshot');

    dm.send(rename('Renamed', 'a'));
    dm.send({
      t: 'intent',
      type: 'grid.update',
      payload: { sceneId: T.scene, snap: false },
      clientRef: 'b',
    });
    dm.send({ t: 'intent', type: 'seat.release', payload: { seatId: T.seatA }, clientRef: 'c' });
    await dm.waitFor('ack', (m) => m.clientRef === 'c');
    await player.waitFor('snapshot', (m) => m.seq === 3);
    await spectator.waitFor('patch', (m) => m.seq === 3);
    const replayed = await connect(GUEST_ID, { lastSeq: 1 });
    await replayed.waitFor('patch', (m) => m.seq === 3);

    expect(dm.frames.join('\n')).toContain('SECRET-DM');
    for (const c of [player, spectator, replayed]) {
      for (const secret of SECRETS) expect(c.frames.join('\n')).not.toContain(secret);
    }
  });

  it('relays ephemerals over ws and never leaks DM-layer previews (M1-07, D32)', async () => {
    const campaign = fixtureCampaign();
    const coDmSeat = campaign.seats[T.coDm];
    const secret = campaign.scenes[T.scene]?.entities[T.secret];
    const token = campaign.scenes[T.scene]?.entities[T.token];
    if (!coDmSeat || !secret || !token) throw new Error('fixture incomplete');
    coDmSeat.identityId = RIVAL_ID;
    secret.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'dm' };
    token.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
    await seed(campaign);
    await start();

    const dm = await connect(HOST_ID, { hostToken: 'test-host-token' });
    const coDm = await connect(RIVAL_ID);
    const player = await connect(PLAYER_ID);
    const spectator = await connect(GUEST_ID);
    await Promise.all([
      dm.waitFor('snapshot'),
      coDm.waitFor('snapshot'),
      player.waitFor('snapshot'),
      spectator.waitFor('snapshot'),
    ]);

    dm.send({
      t: 'ephemeral',
      channel: 'token.drag-preview',
      data: { sceneId: T.scene, entityId: T.secret, to: { x: 1, y: 0, z: 1 } },
      from: GUEST_ID,
    });
    const hidden = await coDm.waitFor(
      'ephemeral',
      (m) =>
        m.channel === 'token.drag-preview' &&
        typeof m.data === 'object' &&
        m.data !== null &&
        'entityId' in m.data &&
        m.data.entityId === T.secret,
    );
    expect(hidden.from).toBe(HOST_ID);
    await dm.waitFor('ephemeral', (m) => m.from === HOST_ID);

    player.send({
      t: 'ephemeral',
      channel: 'token.drag-preview',
      data: { sceneId: T.scene, entityId: T.token, to: { x: 2, y: 0, z: 2 } },
    });
    const visiblePreview = (m: Of<'ephemeral'>) =>
      m.from === PLAYER_ID &&
      typeof m.data === 'object' &&
      m.data !== null &&
      'entityId' in m.data &&
      m.data.entityId === T.token;
    await Promise.all([
      dm.waitFor('ephemeral', visiblePreview),
      coDm.waitFor('ephemeral', visiblePreview),
      player.waitFor('ephemeral', visiblePreview),
      spectator.waitFor('ephemeral', visiblePreview),
    ]);

    for (const audience of [player, spectator]) {
      expect(audience.frames.join('\n')).not.toContain(T.secret);
      expect(audience.messages.some((m) => m.t === 'error' || m.t === 'reject')).toBe(false);
    }
  });
});
