import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { layerLock } from './layer.lock.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'layer.lock';
const payload = { sceneId: IDS.scene, layer: 'tokens' as const, locked: true };
const envelope = (): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

describe(`${T} schema and permissions`, () => {
  it('accepts a valid payload and rejects missing, unknown or extra fields', () => {
    expect(layerLock.schema.safeParse(payload).success).toBe(true);
    expect(layerLock.schema.safeParse({ ...payload, layer: 'secret' }).success).toBe(false);
    expect(layerLock.schema.safeParse({ sceneId: IDS.scene, layer: 'tokens' }).success).toBe(false);
    expect(layerLock.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });

  it('allows only host and co-DM on an existing scene', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
    expect(
      layerLock.permission(makeCampaign(), ACTORS.host, { ...payload, sceneId: IDS.entity }),
    ).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('sets the lock deterministically without mutating the input', () => {
    const before = makeCampaign();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.layers.tokens).toEqual({ locked: true });
    expect(before.scenes[IDS.scene]?.layers.tokens).toBeUndefined();
    expect(result).toEqual(reduceAction(makeCampaign(), envelope()));
  });

  it('broadcasts only the layer lock and never DM-layer data', () => {
    const before = makeCampaign();
    const scene = before.scenes[IDS.scene];
    if (scene)
      scene.entities[IDS.entity] = makeEntity(IDS.entity, {
        layer: 'dm',
        name: 'SECRET',
      });
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      const patches = patchesFor(audience, before, result.state, result.patches);
      expect(JSON.stringify(patches)).not.toContain('SECRET');
      expect(patches).toEqual(result.patches);
    }
  });
});
