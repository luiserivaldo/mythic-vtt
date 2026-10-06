import { describe, expect, it } from 'vitest';
import { canPerform, type Campaign, type Scene } from '@mythic/shared';
import { aoePlacePayload, aoeUpdatePayload, placeDraft, type AoEDraft } from './aoe-placement.js';

const S = '01H00000000000000000000001';
const E = '01H00000000000000000000002';
const scene: Scene = {
  id: S,
  name: 'test',
  grid: {
    type: 'square',
    sizePx: 48,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'chebyshev',
    snap: true,
  },
  environment: { background: '#000000' },
  layers: {},
  entities: {},
};
const campaign: Campaign = {
  id: '01H00000000000000000000003',
  name: 'test',
  schemaVersion: 1,
  settings: {
    defaultBinding: 'session',
    instanceMode: 'forked',
    spectators: { enabled: true, view: 'players' },
  },
  seats: {},
  scenes: { [S]: scene },
  activeSceneId: S,
};
const draft: AoEDraft = { kind: 'cone', size: 3, degrees: 23, elevation: null, x: 2.3, z: 4.6 };

describe('AoE placement', () => {
  it('maps every kind to its geometry dimensions and host-valid place/update payload', () => {
    for (const kind of ['sphere', 'cylinder', 'cone', 'cube', 'line'] as const) {
      const payload = aoePlacePayload(S, E, { ...draft, kind }, scene);
      expect(canPerform(campaign, { kind: 'host' }, 'aoe.place', payload)).toBe(true);
      const withEntity = { ...scene, entities: { [E]: payload.entity } };
      expect(
        canPerform(
          { ...campaign, scenes: { [S]: withEntity } },
          { kind: 'host' },
          'aoe.update',
          aoeUpdatePayload(S, payload.entity, { ...draft, size: 4 }, withEntity),
        ),
      ).toBe(true);
    }
  });
  it('snaps position and rotation while leaving explicit elevation exact', () => {
    const result = placeDraft({ ...draft, elevation: 2.25 }, scene);
    expect(result.transform.position).toEqual({ x: 2, y: 2.25, z: 5 });
    expect(result.transform.rotation.y).toBeCloseTo(Math.sin(Math.PI / 12));
    expect(
      placeDraft(draft, { ...scene, grid: { ...scene.grid, snap: false } }).transform.position,
    ).toEqual({ x: 2.3, y: 0, z: 4.6 });
  });
});
