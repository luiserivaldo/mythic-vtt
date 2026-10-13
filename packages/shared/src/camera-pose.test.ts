import { describe, expect, it } from 'vitest';
import { IDS, makeCampaign } from './actions/testing.js';
import type { Actor } from './actions/envelope.js';
import {
  CAMERA_POSE_CHANNEL,
  canSendCameraPose,
  canViewScene,
  parseCameraPose,
  type CameraPose,
} from './camera-pose.js';

const pose2d: CameraPose = { mode: '2d', centerX: 12.5, centerZ: 7.25, zoom: 48 };
const pose3d: CameraPose = {
  mode: '3d',
  targetX: 12.5,
  targetY: 0.05,
  targetZ: 7.25,
  azimuth: 0.7854,
  polar: 0.96,
  distance: 42,
};
const sceneId = IDS.scene;
/** The pose an enabled co-DM or player seat would send, named for the seat id it belongs to. */
const seatActor = (id: string, identityId: string): Actor => ({
  kind: 'seat',
  seatId: id,
  identityId,
});

describe('camera pose ephemeral (M4-11, CAM-06)', () => {
  it('names the channel that carries a camera pose', () => {
    expect(CAMERA_POSE_CHANNEL).toBe('camera.pose');
  });

  it('parses both camera modes and defaults an absent pull flag to false', () => {
    expect(parseCameraPose({ ...pose2d, sceneId })).toEqual({ ...pose2d, sceneId, pull: false });
    expect(parseCameraPose({ ...pose3d, sceneId, pull: true })).toEqual({
      ...pose3d,
      sceneId,
      pull: true,
    });
  });

  it('ignores the host-stamped sender and any other extra field', () => {
    expect(parseCameraPose({ ...pose2d, sceneId, from: IDS.identity, colour: '#fff' })).toEqual({
      ...pose2d,
      sceneId,
      pull: false,
    });
  });

  it('treats a non-boolean pull flag as absent rather than failing the pose', () => {
    expect(parseCameraPose({ ...pose2d, sceneId, pull: 'yes' })).toEqual({
      ...pose2d,
      sceneId,
      pull: false,
    });
  });

  it('rejects a non-object payload, an unknown mode and missing or non-numeric fields', () => {
    for (const data of [
      null,
      undefined,
      'camera',
      42,
      [pose2d],
      { mode: 'top' },
      { mode: '2d', centerX: 0, centerZ: 0 },
      { ...pose2d, sceneId, zoom: '48' },
      { mode: '3d', targetX: 1, targetY: 0, targetZ: 1, azimuth: 0, polar: 0.9, sceneId },
      { ...pose3d, sceneId, distance: undefined },
    ]) {
      expect(parseCameraPose(data)).toBeNull();
    }
  });

  it('requires the scene the pose was taken in, so a frame without one is refused', () => {
    for (const bad of [undefined, '', 7, null]) {
      expect(parseCameraPose({ ...pose2d, sceneId: bad })).toBeNull();
    }
  });

  it('rejects a non-finite coordinate so a NaN pose never reaches a camera', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(parseCameraPose({ ...pose2d, sceneId, centerX: bad })).toBeNull();
      expect(parseCameraPose({ ...pose3d, sceneId, distance: bad })).toBeNull();
    }
  });

  it('rejects a zero or negative zoom or distance, which no camera can adopt', () => {
    for (const zoom of [0, -1]) expect(parseCameraPose({ ...pose2d, sceneId, zoom })).toBeNull();
    for (const distance of [0, -4]) {
      expect(parseCameraPose({ ...pose3d, sceneId, distance })).toBeNull();
    }
  });

  it('lets the host and an enabled co-DM send a pose, and nobody else', () => {
    const state = makeCampaign();
    const coDm = state.seats[IDS.coDm];
    const owner = state.seats[IDS.owner];
    if (!coDm || !owner) throw new Error('fixture incomplete');
    coDm.identityId = IDS.identity;
    owner.identityId = IDS.otherIdentity;

    expect(canSendCameraPose(state, { kind: 'host', identityId: IDS.owner })).toBe(true);
    expect(canSendCameraPose(state, seatActor(IDS.coDm, IDS.identity))).toBe(true);
    expect(canSendCameraPose(state, seatActor(IDS.owner, IDS.otherIdentity))).toBe(false);
    // A seat-less actor is a spectator: it may follow a camera, never move anyone else's.
    expect(canSendCameraPose(state, seatActor(IDS.identity, IDS.identity))).toBe(false);
    // Mods have no seat and no camera authority either.
    expect(canSendCameraPose(state, { kind: 'mod', modId: IDS.identity })).toBe(false);
  });

  it('refuses a co-DM whose seat has interaction disabled (UI-SEAT-05)', () => {
    const state = makeCampaign();
    const coDm = state.seats[IDS.coDm];
    if (!coDm) throw new Error('fixture incomplete');
    coDm.identityId = IDS.identity;
    coDm.interactionEnabled = false;
    expect(canSendCameraPose(state, seatActor(IDS.coDm, IDS.identity))).toBe(false);
  });

  it('delivers a pose only to audiences that may see its scene (PERM-03)', () => {
    const state = makeCampaign();
    const coDm = state.seats[IDS.coDm];
    const player = state.seats[IDS.owner];
    const base = state.scenes[sceneId];
    if (!coDm || !player || !base) throw new Error('fixture incomplete');
    const dmSeat = { kind: 'seat', seatId: IDS.coDm } as const;
    const playerSeat = { kind: 'seat', seatId: IDS.owner } as const;
    const hiddenSceneId = '01HIDDENSCENE0000000000000';
    const withDmScene = {
      ...state,
      scenes: { ...state.scenes, [hiddenSceneId]: { ...base, id: hiddenSceneId, dmOnly: true } },
    };

    // The active, ordinary scene reaches everyone who is in it.
    expect(canViewScene(withDmScene, { kind: 'host' }, undefined, sceneId)).toBe(true);
    expect(canViewScene(withDmScene, dmSeat, coDm, sceneId)).toBe(true);
    expect(canViewScene(withDmScene, playerSeat, player, sceneId)).toBe(true);
    expect(canViewScene(withDmScene, { kind: 'spectators' }, undefined, sceneId)).toBe(true);

    // A DM-only scene is the host's and a co-DM's only; a player or spectator never receives it.
    expect(canViewScene(withDmScene, { kind: 'host' }, undefined, hiddenSceneId)).toBe(true);
    expect(canViewScene(withDmScene, dmSeat, coDm, hiddenSceneId)).toBe(true);
    expect(canViewScene(withDmScene, playerSeat, player, hiddenSceneId)).toBe(false);
    expect(canViewScene(withDmScene, { kind: 'spectators' }, undefined, hiddenSceneId)).toBe(false);

    // A scene that is not the active one is no longer any player's or spectator's; an unknown
    // scene reaches nobody at all.
    const behind = { ...withDmScene, activeSceneId: hiddenSceneId };
    expect(canViewScene(behind, playerSeat, player, sceneId)).toBe(false);
    expect(canViewScene(behind, { kind: 'spectators' }, undefined, sceneId)).toBe(false);
    expect(
      canViewScene(withDmScene, { kind: 'host' }, undefined, '01NOSUCHSCENE000000000000'),
    ).toBe(false);
  });
});
