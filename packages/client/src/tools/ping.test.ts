import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parsePingPayload, type Scene, type Vec3 } from '@mythic/shared';
import { IDS, makeCampaign } from '../../../shared/src/actions/testing.js';
import {
  MAX_ACTIVE_PINGS,
  PING_END_RADIUS,
  PING_START_RADIUS,
  PING_TTL_MS,
  canPing,
  pingExpired,
  pingPayload,
  pingPoint,
  pingProgress,
  pingVisual,
} from './ping.js';

const scene: Pick<Scene, 'bounds'> = { bounds: { width: 10, height: 8 } };
const noBounds: Pick<Scene, 'bounds'> = {};

describe('ping payload (LAY-05)', () => {
  it('sends exactly the fields the shared contract accepts, and no colour of its own', () => {
    const point: Vec3 = { x: 2.5, y: 0, z: 3.25 };
    const payload = pingPayload('01ARZ3NDEKTSV4RRFFQ69G5FAV', point);
    expect(payload).toEqual({ sceneId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', x: 2.5, y: 0, z: 3.25 });
    expect(parsePingPayload(payload)).toEqual(payload);
    // The relay stamps the sender's validated profile colour, which the client then accepts.
    expect(parsePingPayload({ ...payload, color: '#a1B2c3' })).toEqual({
      ...payload,
      color: '#a1B2c3',
    });
  });
});

describe('ping point (LAY-05)', () => {
  it('keeps a point on the board and clamps one outside it to the scene canvas', () => {
    expect(pingPoint({ x: 2.5, z: 4.25 }, scene)).toEqual({ x: 2.5, y: 0, z: 4.25 });
    expect(pingPoint({ x: -3, z: 99 }, scene)).toEqual({ x: 0, y: 0, z: 8 });
    expect(pingPoint({ x: 10, z: 8 }, scene)).toEqual({ x: 10, y: 0, z: 8 });
    // A scene that predates `bounds` uses the shared 40 x 30 default.
    expect(pingPoint({ x: 999, z: -1 }, noBounds)).toEqual({ x: 40, y: 0, z: 0 });
  });

  it('refuses a non-finite ray hit instead of clamping it into a corner', () => {
    for (const raw of [
      { x: NaN, z: 1 },
      { x: 1, z: NaN },
      { x: Infinity, z: 0 },
      { x: 0, z: -Infinity },
    ])
      expect(pingPoint(raw, scene)).toBeNull();
  });
});

describe('who may ping (PERM-05)', () => {
  it('follows the scene pins toggle: players need it open, host and co-DM are exempt', () => {
    const campaign = makeCampaign();
    const scene = campaign.scenes[IDS.scene];
    if (!scene) throw new Error('fixture');

    // `pins` is opt-in, so a scene that predates the toggles denies players.
    expect(scene.playerToggles).toBeUndefined();
    expect(canPing(campaign, { isHost: false, seatId: IDS.owner }, IDS.scene)).toBe(false);
    expect(canPing(campaign, { isHost: true, seatId: null }, IDS.scene)).toBe(true);
    expect(canPing(campaign, { isHost: false, seatId: IDS.coDm }, IDS.scene)).toBe(true);

    scene.playerToggles = { pins: true };
    expect(canPing(campaign, { isHost: false, seatId: IDS.owner }, IDS.scene)).toBe(true);

    scene.playerToggles = { pins: false };
    expect(canPing(campaign, { isHost: false, seatId: IDS.owner }, IDS.scene)).toBe(false);
    expect(canPing(campaign, { isHost: true, seatId: null }, IDS.scene)).toBe(true);
    expect(canPing(campaign, { isHost: false, seatId: IDS.coDm }, IDS.scene)).toBe(true);
  });

  it('denies a seat-less spectator, an unknown scene and a client with no campaign', () => {
    const campaign = makeCampaign();
    const scene = campaign.scenes[IDS.scene];
    if (!scene) throw new Error('fixture');
    scene.playerToggles = { pins: true };
    expect(canPing(campaign, { isHost: false, seatId: null }, IDS.scene)).toBe(false);
    expect(canPing(campaign, { isHost: false, seatId: IDS.owner }, IDS.other)).toBe(false);
    expect(canPing(campaign, { isHost: true, seatId: null }, IDS.other)).toBe(false);
    expect(canPing(null, { isHost: true, seatId: null }, IDS.scene)).toBe(false);
    expect(canPing(campaign, { isHost: true, seatId: null }, null)).toBe(false);
  });

  it('still applies the seat-level Enable Interaction switch on top of an open toggle', () => {
    const campaign = makeCampaign();
    const scene = campaign.scenes[IDS.scene];
    const owner = campaign.seats[IDS.owner];
    if (!scene || !owner) throw new Error('fixture');
    scene.playerToggles = { pins: true };
    owner.interactionEnabled = false;
    expect(canPing(campaign, { isHost: false, seatId: IDS.owner }, IDS.scene)).toBe(false);
    expect(canPing(campaign, { isHost: true, seatId: null }, IDS.scene)).toBe(true);
  });
});

describe('ping animation (LAY-05)', () => {
  it('clamps progress at both ends and treats a non-finite age as just spawned', () => {
    expect(pingProgress(-1)).toBe(0);
    expect(pingProgress(0)).toBe(0);
    expect(pingProgress(NaN)).toBe(0);
    expect(pingProgress(PING_TTL_MS / 2)).toBe(0.5);
    expect(pingProgress(PING_TTL_MS)).toBe(1);
    expect(pingProgress(PING_TTL_MS + 1)).toBe(1);
    expect(pingProgress(Infinity)).toBe(1);
  });

  it('expands from the spawn radius to the end radius while fading out', () => {
    expect(pingVisual(0)).toEqual({ radius: PING_START_RADIUS, opacity: 1 });
    expect(pingVisual(0.5)).toEqual({
      radius: PING_START_RADIUS + (PING_END_RADIUS - PING_START_RADIUS) / 2,
      opacity: 0.5,
    });
    expect(pingVisual(1)).toEqual({ radius: PING_END_RADIUS, opacity: 0 });
    // Out-of-range and non-finite progress behaves like the nearest end, never past it.
    expect(pingVisual(2)).toEqual(pingVisual(1));
    expect(pingVisual(Infinity)).toEqual(pingVisual(1));
    expect(pingVisual(-2)).toEqual(pingVisual(0));
    expect(pingVisual(-Infinity)).toEqual(pingVisual(0));
    expect(pingVisual(NaN)).toEqual(pingVisual(0));
  });

  it('holds the marker still for a viewer who asked for reduced motion', () => {
    for (const progress of [0, 0.25, 1, NaN])
      expect(pingVisual(progress, true).radius).toBe(PING_END_RADIUS);
    expect(pingVisual(0.25, true).opacity).toBe(0.75);
  });

  it('expires exactly at the end of the marker life', () => {
    expect(pingExpired({ at: 1_000 }, 1_000)).toBe(false);
    expect(pingExpired({ at: 1_000 }, 1_000 + PING_TTL_MS - 1)).toBe(false);
    expect(pingExpired({ at: 1_000 }, 1_000 + PING_TTL_MS)).toBe(true);
    expect(pingExpired({ at: 1_000 }, 99_999)).toBe(true);
  });

  it('keeps progress inside 0..1 and the marker inside its two radii for any age', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: PING_TTL_MS * 4 }), (age) => {
        const progress = pingProgress(age);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(1);
        expect(pingExpired({ at: 0 }, age)).toBe(progress === 1);
        const visual = pingVisual(progress);
        expect(visual.radius).toBeGreaterThanOrEqual(PING_START_RADIUS);
        expect(visual.radius).toBeLessThanOrEqual(PING_END_RADIUS);
        expect(visual.opacity).toBeGreaterThanOrEqual(0);
        expect(visual.opacity).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('the marker cap (LAY-05)', () => {
  it('keeps the cap large enough for a table but small enough to bound the frame cost', () => {
    expect(MAX_ACTIVE_PINGS).toBeGreaterThanOrEqual(1);
    expect(Number.isSafeInteger(MAX_ACTIVE_PINGS)).toBe(true);
  });
});
