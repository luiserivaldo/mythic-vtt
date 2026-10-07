import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

const PLAYER_COUNT = 10;
const MOVES_PER_SECOND = 20;
const BURST_SECONDS = 10;
const MOVE_COUNT = MOVES_PER_SECOND * BURST_SECONDS;
const DIRECT_P95_BUDGET_MS = 150;

interface LoadResult {
  ack: { p50: number; p95: number; p99: number };
  broadcast: { p50: number; p95: number; p99: number };
  seqGaps: number;
  droppedPatches: number;
  rejectedMoves: number;
  previewFrames: number;
  cpuPercent?: number;
  peakRssMb?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentiles(values: readonly number[]) {
  if (values.length === 0) throw new Error('cannot calculate percentiles without samples');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

function withoutEntity(state: unknown, sceneId: string, entityId: string): unknown {
  const clone = structuredClone(state) as {
    scenes?: Record<string, { entities?: Record<string, unknown> }>;
  };
  const entities = clone.scenes?.[sceneId]?.entities;
  if (entities) Reflect.deleteProperty(entities, entityId);
  return clone;
}

test('@load M1-24: one DM and ten seated players sustain move bursts', async () => {
  test.setTimeout(120_000);
  const table = await startTable();
  const clients: RawClient[] = [];
  try {
    const dm = await RawClient.connect(table, {
      name: 'dm',
      identityId: testUlid('HOST', 1),
      identitySecret: 'load-host-secret',
      hostToken: table.hostToken,
    });
    clients.push(dm);
    await dm.waitFor('DM snapshot', () => dm.state !== undefined);

    const sceneId = testUlid('SCENE', 1);
    const secretId = testUlid('DMSECRET', 1);
    const identities = Array.from({ length: PLAYER_COUNT }, (_, index) => ({
      identityId: testUlid('PLAYER', index + 1),
      identitySecret: `load-player-secret-${String(index + 1)}`,
      seatId: testUlid('SEAT', index + 1),
      tokenId: testUlid('TOKEN', index + 1),
    }));

    expect(await dm.intent('scene.create', { sceneId, name: 'Load arena' })).toMatchObject({
      t: 'ack',
    });
    expect(await dm.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
    expect(
      await dm.intent('entity.create', {
        sceneId,
        entity: {
          id: secretId,
          layer: 'dm',
          name: 'LOAD-TEST-DM-SECRET',
          owners: [],
          transform: {
            position: { x: 1, y: 0, z: 1 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'dm' },
        },
      }),
    ).toMatchObject({ t: 'ack' });

    for (const [index, identity] of identities.entries()) {
      expect(
        await dm.intent('seat.create', {
          seatId: identity.seatId,
          label: `Player ${String(index + 1)}`,
        }),
      ).toMatchObject({ t: 'ack' });
      expect(
        await dm.intent('seat.assign', {
          seatId: identity.seatId,
          identityId: identity.identityId,
        }),
      ).toMatchObject({ t: 'ack' });
      expect(
        await dm.intent('entity.create', {
          sceneId,
          entity: {
            id: identity.tokenId,
            layer: 'tokens',
            name: `Load token ${String(index + 1)}`,
            owners: [identity.seatId],
            transform: {
              position: { x: index + 2.5, y: 0, z: index + 2.5 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
          },
        }),
      ).toMatchObject({ t: 'ack' });
    }

    const players = await Promise.all(
      identities.map((identity, index) =>
        RawClient.connect(table, {
          name: `player-${String(index + 1)}`,
          identityId: identity.identityId,
          identitySecret: identity.identitySecret,
        }),
      ),
    );
    clients.push(...players);
    await Promise.all(
      players.map((player) => player.waitFor('snapshot', () => player.state !== undefined)),
    );
    expect((await table.connections()).authenticated).toBe(PLAYER_COUNT + 1);

    const allClients = [dm, ...players];
    const frameStarts = new Map(allClients.map((client) => [client, client.durableFrames.length]));
    const ackLatencies: number[] = [];
    const sendTimes = new Map<number, number>();
    let rejectedMoves = 0;
    const baselineMetrics = await table.hostProcessMetrics();
    const metricSamples = baselineMetrics ? [baselineMetrics] : [];
    const sampler = setInterval(() => {
      void table.hostProcessMetrics().then((sample) => {
        if (sample) metricSamples.push(sample);
      });
    }, 250);

    const startedAt = performance.now();
    const pending: Promise<void>[] = [];
    await Promise.all(
      players.map(async (player, playerIndex) => {
        const identity = identities[playerIndex];
        if (!identity) throw new Error(`identity ${String(playerIndex)} missing`);
        for (let move = 0; move < MOVE_COUNT; move++) {
          const dueAt = startedAt + (move * 1000) / MOVES_PER_SECOND;
          const remaining = dueAt - performance.now();
          if (remaining > 0) await delay(remaining);
          const position = {
            x: playerIndex + (move % 2 === 0 ? 3.5 : 4.5),
            y: 0,
            z: playerIndex + 2.5,
          };
          if (move % 2 === 0) {
            player.ephemeral('token.drag-preview', {
              sceneId,
              entityId: identity.tokenId,
              position,
            });
          }
          const sentAt = performance.now();
          pending.push(
            player
              .intent('token.move', { sceneId, entityId: identity.tokenId, position })
              .then((reply) => {
                ackLatencies.push(performance.now() - sentAt);
                if (reply.t === 'reject' || reply.seq === undefined) rejectedMoves += 1;
                else sendTimes.set(reply.seq, sentAt);
              }),
          );
        }
      }),
    );
    await Promise.all(pending);
    clearInterval(sampler);

    const finalSeq = Math.max(...sendTimes.keys());
    await Promise.all(allClients.map((client) => client.waitForSeq(finalSeq)));
    const finalMetrics = await table.hostProcessMetrics();
    if (finalMetrics) metricSamples.push(finalMetrics);

    const expectedMoves = PLAYER_COUNT * MOVE_COUNT;
    expect(sendTimes.size).toBe(expectedMoves);
    const firstSeq = Math.min(...sendTimes.keys());
    const broadcastLatencies: number[] = [];
    let seqGaps = 0;
    let droppedPatches = 0;
    for (const client of allClients) {
      const frames = client.durableFrames
        .slice(frameStarts.get(client) ?? 0)
        .filter((frame) => frame.seq >= firstSeq && frame.seq <= finalSeq);
      const received = new Set(frames.map((frame) => frame.seq));
      for (let seq = firstSeq; seq <= finalSeq; seq++) {
        if (!received.has(seq)) droppedPatches += 1;
      }
      for (let index = 1; index < frames.length; index++) {
        if ((frames[index]?.seq ?? 0) !== (frames[index - 1]?.seq ?? 0) + 1) seqGaps += 1;
      }
      for (const frame of frames) {
        const sentAt = sendTimes.get(frame.seq);
        if (sentAt !== undefined) broadcastLatencies.push(frame.receivedAt - sentAt);
      }
    }

    const secretNeedles = [secretId, 'LOAD-TEST-DM-SECRET'];
    for (const player of players) {
      expect(
        player.frames.filter((frame) => secretNeedles.some((needle) => frame.includes(needle))),
        `${player.opts.name} received DM-layer data`,
      ).toEqual([]);
    }

    const publicHostState = withoutEntity(dm.state, sceneId, secretId);
    for (const player of players) expect(player.state).toEqual(publicHostState);

    const ack = percentiles(ackLatencies);
    const broadcast = percentiles(broadcastLatencies);
    const elapsedMs = Math.max(1, performance.now() - startedAt);
    const cpuPercent =
      baselineMetrics && finalMetrics
        ? ((finalMetrics.cpuTimeMs - baselineMetrics.cpuTimeMs) / elapsedMs) * 100
        : undefined;
    const peakRssMb =
      metricSamples.length > 0
        ? Math.max(...metricSamples.map((sample) => sample.rssBytes)) / 1024 / 1024
        : undefined;
    const previewFrames = dm.frames.filter(
      (frame) => frame.includes('"t":"ephemeral"') && frame.includes('token.drag-preview'),
    ).length;
    const result: LoadResult = {
      ack,
      broadcast,
      seqGaps,
      droppedPatches,
      rejectedMoves,
      previewFrames,
      ...(cpuPercent === undefined ? {} : { cpuPercent }),
      ...(peakRssMb === undefined ? {} : { peakRssMb }),
    };

    expect(ack.p95).toBeLessThanOrEqual(DIRECT_P95_BUDGET_MS);
    expect(seqGaps).toBe(0);
    expect(droppedPatches).toBe(0);
    expect(rejectedMoves).toBe(0);
    expect(previewFrames).toBeGreaterThan(0);
    console.log(
      `M1-24 load results: ack p50/p95/p99 ${ack.p50.toFixed(1)}/${ack.p95.toFixed(1)}/${ack.p99.toFixed(1)} ms; broadcast ${broadcast.p50.toFixed(1)}/${broadcast.p95.toFixed(1)}/${broadcast.p99.toFixed(1)} ms; gaps ${String(seqGaps)}; dropped ${String(droppedPatches)}; rejected ${String(rejectedMoves)}; previews ${String(previewFrames)}${cpuPercent === undefined ? '' : `; host CPU ${cpuPercent.toFixed(1)}%`}${peakRssMb === undefined ? '' : `; peak RSS ${peakRssMb.toFixed(1)} MiB`}`,
    );
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
