import { describe, expect, it } from 'vitest';
import { canPerform, snapToGrid, type Campaign, type Scene } from '@mythic/shared';
import {
  aoePlacePayload,
  aoeUpdatePayload,
  degreesReadout,
  placeDraft,
  sceneUnitReadout,
  type AoEDraft,
} from './aoe-placement.js';

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
      expect(canPerform(campaign, { kind: 'host', identityId: E }, 'aoe.place', payload)).toBe(
        true,
      );
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
    expect(result.transform.position).toEqual({ x: 2.5, y: 2.25, z: 4.5 });
    expect(result.transform.rotation.y).toBeCloseTo(Math.sin(Math.PI / 12));
    expect(
      placeDraft(draft, { ...scene, grid: { ...scene.grid, snap: false } }).transform.position,
    ).toEqual({ x: 2.3, y: 0, z: 4.6 });
  });
  it('stores the snapToGrid cell centre when snap is on', () => {
    const raw = { ...draft, x: 32.744568807685766, z: 4.6, elevation: 0 };
    expect(placeDraft(raw, scene).transform.position).toEqual(
      snapToGrid({ x: raw.x, y: 0, z: raw.z }, scene.grid),
    );
    expect(placeDraft(raw, scene).transform.position).toEqual({ x: 32.5, y: 0, z: 4.5 });
  });
  it('stores the value as given when snap is off', () => {
    const off = { ...scene, grid: { ...scene.grid, snap: false } };
    expect(
      placeDraft({ ...draft, x: 32.744568807685766, elevation: 0 }, off).transform.position,
    ).toEqual({ x: 32.744568807685766, y: 0, z: 4.6 });
  });
  it('snaps grid lines, zero and negative cells to a cell centre', () => {
    expect(placeDraft({ ...draft, x: 3, elevation: 0 }, scene).transform.position).toEqual({
      x: 3.5,
      y: 0,
      z: 4.5,
    });
    expect(placeDraft({ ...draft, x: 0, elevation: 0 }, scene).transform.position.x).toBe(0.5);
    expect(
      placeDraft({ ...draft, x: -2, z: -2.3, elevation: 0 }, scene).transform.position,
    ).toEqual({ x: -1.5, y: 0, z: -2.5 });
  });
  it('leaves a non-square grid unsnapped instead of throwing', () => {
    const hex = { ...scene, grid: { ...scene.grid, type: 'hex' as const } };
    expect(placeDraft({ ...draft, x: 2.3, z: 4.6, elevation: 0 }, hex).transform.position).toEqual({
      x: 2.3,
      y: 0,
      z: 4.6,
    });
    expect(() => placeDraft(draft, hex)).not.toThrow();
  });
});

describe('AoE panel readout', () => {
  it('rounds the raw draft to whole scene units while the stored value stays exact', () => {
    const raw = { ...draft, x: 32.744568807685766, elevation: 0 };
    const off = { ...scene, grid: { ...scene.grid, snap: false } };
    expect(placeDraft(raw, off).transform.position.x).toBe(32.744568807685766);
    expect(sceneUnitReadout(placeDraft(raw, off).transform.position.x, scene.grid)).toBe(164);
  });
  it('rounds zero, negatives, halves and float noise', () => {
    expect(sceneUnitReadout(0, scene.grid)).toBe(0);
    expect(sceneUnitReadout(0.032, scene.grid)).toBe(0);
    expect(sceneUnitReadout(3, scene.grid)).toBe(15);
    expect(sceneUnitReadout(4.6, scene.grid)).toBe(23);
    expect(sceneUnitReadout(-3.4, scene.grid)).toBe(-17);
    expect(sceneUnitReadout(3.8000000000000003, scene.grid)).toBe(19);
  });
  it('never renders negative zero', () => {
    expect(Object.is(sceneUnitReadout(-0, scene.grid), 0)).toBe(true);
    expect(Object.is(sceneUnitReadout(-0.01, scene.grid), 0)).toBe(true);
  });
  it('passes NaN and both infinities through, so an invalid field stays visibly invalid', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(sceneUnitReadout(bad, scene.grid)).toBe(bad);
      expect(degreesReadout(bad)).toBe(bad);
    }
  });
  it('shows yaw to one decimal instead of a float tail', () => {
    expect(degreesReadout(23)).toBe(23);
    expect(degreesReadout(22.75)).toBe(22.8);
    expect(degreesReadout(22.749)).toBe(22.7);
    expect(Object.is(degreesReadout(-0.04), 0)).toBe(true);
  });
});
