import { expect, it } from 'vitest';
import { createEngine } from './engine.js';
import {
  fakeClock,
  fakeConnection,
  fakeRandom,
  fixtureCampaign,
  memoryLog,
  T,
  tid,
} from './testing.js';

it('logs host-derived round/turn context from the actual action scene and records transitions', async () => {
  const state = fixtureCampaign();
  const scene = state.scenes[T.scene];
  if (!scene) throw new Error('missing scene');
  const token = scene.entities[T.hiddenName];
  if (token?.token) token.token.labelVisibility = 'all';
  scene.initiative = { round: 3, order: [T.hiddenName], activeEntityId: T.hiddenName };
  const log = memoryLog();
  const engine = createEngine({
    campaign: state,
    sessionId: tid(20),
    store: log,
    clock: fakeClock(),
    random: fakeRandom(),
  });
  const host = fakeConnection(T.host, { isHost: true });
  await engine.onConnect(host);
  await engine.onIntent(host, {
    t: 'intent',
    type: 'token.move',
    sceneId: T.newScene,
    clientRef: 'move',
    payload: { sceneId: T.scene, entityId: T.hiddenName, to: { x: 1, y: 0, z: 0 } },
  });
  await engine.onIntent(host, {
    t: 'intent',
    type: 'initiative.advance',
    clientRef: 'next',
    payload: { sceneId: T.scene },
  });
  await engine.onIntent(host, {
    t: 'intent',
    type: 'token.move',
    clientRef: 'move-again',
    payload: { sceneId: T.scene, entityId: T.hiddenName, to: { x: 2, y: 0, z: 0 } },
  });
  expect(log.entries.map((entry) => [entry.envelope.round, entry.envelope.turn])).toEqual([
    [3, 1],
    [3, 1],
    [4, 1],
  ]);
});
