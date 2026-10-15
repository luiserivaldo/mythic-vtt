import { Campaign } from '@mythic/shared';
import { describe, expect, it, vi } from 'vitest';
import { createClientStore } from '../store/store.js';
import { makeCampaign, tid } from '../testing.js';
import {
  capturePublicBoard,
  fitThumbnail,
  isUploadableThumbnail,
  signOutWithThumbnail,
  THUMBNAIL_BOX,
  THUMBNAIL_MAX_BYTES,
} from './campaign-thumbnail.js';

const sceneId = tid(2);
const seatId = tid(3);
const secretId = tid(4);
const heroId = tid(5);
const hiddenId = tid(6);

function world(): Campaign {
  const token = (id: string, layer: string, name: string, extra: object = {}) => ({
    id,
    layer,
    name,
    owners: [],
    transform: {
      position: { x: 1, y: 0, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    ...extra,
  });
  return Campaign.parse({
    ...makeCampaign(),
    activeSceneId: sceneId,
    seats: {
      [seatId]: {
        id: seatId,
        label: 'Mira',
        binding: 'persistent',
        identityId: null,
        role: 'player',
        permissions: { view: true, move: true, edit: false, delete: false },
      },
    },
    scenes: {
      [sceneId]: {
        id: sceneId,
        name: 'Crypt',
        grid: {
          type: 'square',
          sizePx: 70,
          unitsPerCell: 5,
          unitLabel: 'ft',
          diagonal: 'alternating',
          snap: true,
        },
        environment: { background: '#000000' },
        layers: {},
        entities: {
          [secretId]: token(secretId, 'dm', 'Lich'),
          [heroId]: token(heroId, 'tokens', 'Hero'),
          [hiddenId]: token(hiddenId, 'tokens', 'Ambush', { perms: { view: false } }),
        },
      },
    },
  });
}

function dmStore() {
  const store = createClientStore();
  store.getState().setHost(true);
  store.getState().applyServerMessage({ t: 'snapshot', seq: 1, seatId: null, state: world() });
  return store;
}
const control = (store: ReturnType<typeof createClientStore>) => ({
  getState: () => store.getState(),
  setViewAs: store.getState().setViewAs,
  setSpectatorSource: store.getState().setSpectatorSource,
});
const blob = (size: number, type = 'image/webp') => ({ size, type });

describe('thumbnail limits (UX-05)', () => {
  it('scales a capture down into the thumbnail box, never up, keeping the aspect', () => {
    expect(fitThumbnail(1920, 1080)).toEqual(THUMBNAIL_BOX);
    expect(fitThumbnail(1280, 800)).toEqual({ width: 576, height: 360 });
    expect(fitThumbnail(400, 1000)).toEqual({ width: 144, height: 360 });
    expect(fitThumbnail(320, 180)).toEqual({ width: 320, height: 180 });
    expect(fitThumbnail(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it('uploads only a non-empty PNG, JPEG or WebP within the byte budget', () => {
    expect(isUploadableThumbnail(blob(10_000))).toBe(true);
    expect(isUploadableThumbnail(blob(THUMBNAIL_MAX_BYTES, 'image/png'))).toBe(true);
    expect(isUploadableThumbnail(blob(THUMBNAIL_MAX_BYTES + 1))).toBe(false);
    expect(isUploadableThumbnail(blob(0))).toBe(false);
    expect(isUploadableThumbnail(blob(10, 'image/svg+xml'))).toBe(false);
    expect(isUploadableThumbnail(blob(10, ''))).toBe(false);
  });
});

describe('capturing the board as spectators see it (UX-05, PERM-03)', () => {
  it('renders only what the spectators audience may see, then restores the DM view', async () => {
    const store = dmStore();
    store.getState().setSpectatorSource(seatId);
    let seen: string[] = [];
    const result = await capturePublicBoard(control(store), () => {
      const scene = store.getState().campaign?.scenes[sceneId];
      seen = Object.values(scene?.entities ?? {}).map((e) => e.name);
      expect(store.getState().isHost).toBe(false);
      return Promise.resolve(new Blob(['png']));
    });
    expect(result).not.toBeNull();
    expect(seen).toEqual(['Hero']);
    expect(store.getState().viewAs).toEqual({ kind: 'host' });
    expect(store.getState().spectatorSeatId).toBe(seatId);
    expect(store.getState().isHost).toBe(true);
    expect(Object.keys(store.getState().campaign?.scenes[sceneId]?.entities ?? {})).toHaveLength(3);
  });

  it('captures nothing when the preview cannot be entered, never the DM view', async () => {
    const pending = dmStore();
    pending.getState().setPendingIntents(1);
    const render = vi.fn(() => Promise.resolve(new Blob(['png'])));
    expect(await capturePublicBoard(control(pending), render)).toBeNull();
    const player = createClientStore();
    player.getState().applyServerMessage({ t: 'snapshot', seq: 1, seatId, state: world() });
    expect(await capturePublicBoard(control(player), render)).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it('restores the DM view when rendering fails', async () => {
    const store = dmStore();
    await expect(
      capturePublicBoard(control(store), () => Promise.reject(new Error('lost context'))),
    ).rejects.toThrow('lost context');
    expect(store.getState().viewAs).toEqual({ kind: 'host' });
  });
});

describe('signing out (UI-HOST-02)', () => {
  const hash = 'f'.repeat(64);
  const deps = (capture: Blob | null | Error, sent = true) => {
    const calls = { upload: 0, send: [] as unknown[], stop: 0 };
    return {
      calls,
      deps: {
        capture: () =>
          capture instanceof Error ? Promise.reject(capture) : Promise.resolve(capture),
        upload: () => {
          calls.upload += 1;
          return Promise.resolve({ hash, width: 640, height: 360 });
        },
        send: (spec: unknown) => {
          calls.send.push(spec);
          return Promise.resolve(sent);
        },
        stop: () => {
          calls.stop += 1;
        },
      },
    };
  };

  it('uploads the capture and stores it as the auto screenshot before signing out', async () => {
    const { calls, deps: d } = deps(new Blob(['x'], { type: 'image/webp' }));
    expect(await signOutWithThumbnail(d)).toBe('captured');
    expect(calls.upload).toBe(1);
    expect(calls.send).toEqual([
      { type: 'campaign.setBranding', payload: { autoScreenshot: hash } },
    ]);
    expect(calls.stop).toBe(1);
  });

  it('still signs out when there is nothing to capture, it is too big, or it fails', async () => {
    for (const [capture, outcome] of [
      [null, 'skipped'],
      [new Blob([new Uint8Array(THUMBNAIL_MAX_BYTES + 1)], { type: 'image/webp' }), 'skipped'],
      [new Error('no frame'), 'failed'],
    ] as const) {
      const { calls, deps: d } = deps(capture);
      expect(await signOutWithThumbnail(d)).toBe(outcome);
      expect(calls.upload).toBe(0);
      expect(calls.stop).toBe(1);
    }
    const rejected = deps(new Blob(['x'], { type: 'image/webp' }), false);
    expect(await signOutWithThumbnail(rejected.deps)).toBe('failed');
    expect(rejected.calls.stop).toBe(1);
  });
});
