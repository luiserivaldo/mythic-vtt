import { expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { T, fixtureCampaign, memoryLog, tid, fakeConnection } from './testing.js';
import { newCampaign } from './campaign.js';

it('starts a new campaign with a blank active scene', () => {
  const state = newCampaign(tid(30), 'Fresh');
  expect(Object.keys(state.scenes)).toHaveLength(1);
  expect(state.scenes[state.activeSceneId ?? '']).toMatchObject({
    name: 'Blank scene',
    dmOnly: false,
  });
});
it('filters private scene changes and blocks late joins while existing players receive empty state', async () => {
  const state = fixtureCampaign();
  const initial = state.activeSceneId;
  const privateId = tid(28);
  const source = Object.values(state.scenes)[0];
  if (!source || !initial) throw new Error('fixture lacks scene');
  state.scenes[privateId] = {
    ...structuredClone(source),
    id: privateId,
    name: 'SECRET-PRIVATE',
    dmOnly: true,
  };
  const log = memoryLog();
  const engine = createEngine({ campaign: state, sessionId: tid(20), store: log });
  const host = fakeConnection(T.host, { isHost: true });
  const player = fakeConnection(T.alice);
  await engine.onConnect(host);
  await engine.onConnect(player);
  await engine.onIntent(host, {
    t: 'intent',
    clientRef: 'delete',
    type: 'scene.delete',
    payload: { sceneId: initial },
  });
  expect(engine.state().activeSceneId).toBeNull();
  expect(player.wire()).not.toContain(privateId);
  expect(player.wire()).not.toContain('SECRET-PRIVATE');
  const late = fakeConnection(tid(29));
  await engine.onConnect(late);
  await engine.onJoin(late, { t: 'join', seatId: T.seatB });
  const error = late.received.find((message) => message.t === 'error');
  expect(error?.t).toBe('error');
  if (error?.t !== 'error') throw new Error('missing join rejection');
  expect(error.message).toContain('No active scene');
  expect(log.entries).toHaveLength(1);
  expect(engine.state().seats[T.seatB]?.identityId).toBeNull();
});
