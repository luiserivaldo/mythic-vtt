import { describe, expect, it } from 'vitest';
import {
  defaultPlacementScale,
  localDistance,
  localToWorld,
  pixelsPerCell,
  solveCalibration,
  toCells,
  worldToLocal,
  type CalibrationInput,
} from './battlemap-calibration.js';

// Deterministic pseudo-random inputs (mulberry32): property-style without a new dependency.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base: CalibrationInput = {
  a: { x: -0.25, z: 0 },
  b: { x: 0.25, z: 0 },
  distance: 10,
  unit: 'scene',
  unitsPerCell: 5,
  current: { position: { x: 3, y: 0, z: -2 }, scale: 20 },
  anchor: 'keep',
};

describe('solveCalibration', () => {
  it('converts scene units through unitsPerCell', () => {
    // 10 ft at 5 ft/cell = 2 cells over 0.5 image heights => scale 4.
    const r = solveCalibration(base);
    expect(r).toMatchObject({ ok: true, scale: 4, cells: 2 });
  });

  it('treats the unit "cells" as already in cells', () => {
    const r = solveCalibration({ ...base, distance: 2, unit: 'cells' });
    expect(r).toMatchObject({ ok: true, scale: 4 });
  });

  it('keeps the first point fixed in world space by default', () => {
    const r = solveCalibration(base);
    if (!r.ok) throw new Error('expected ok');
    const before = localToWorld(base.a, base.current.position, base.current.scale);
    const after = localToWorld(base.a, r.position, r.scale);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    expect(r.position.y).toBe(0);
  });

  it('snaps the first point to the nearest grid intersection', () => {
    const r = solveCalibration({ ...base, anchor: 'snap' });
    if (!r.ok) throw new Error('expected ok');
    const after = localToWorld(base.a, r.position, r.scale);
    expect(after.x).toBeCloseTo(Math.round(localToWorld(base.a, base.current.position, 20).x), 9);
    expect(after.z).toBeCloseTo(Math.round(localToWorld(base.a, base.current.position, 20).z), 9);
  });

  it('rejects identical or near-identical points', () => {
    expect(solveCalibration({ ...base, b: base.a })).toEqual({
      ok: false,
      error: 'identical-points',
    });
    expect(solveCalibration({ ...base, b: { x: base.a.x + 1e-6, z: base.a.z } })).toEqual({
      ok: false,
      error: 'identical-points',
    });
  });

  it('rejects non-positive or non-finite distances and grids', () => {
    for (const distance of [0, -5, Number.NaN, Infinity]) {
      expect(solveCalibration({ ...base, distance })).toEqual({
        ok: false,
        error: 'invalid-distance',
      });
    }
    for (const unitsPerCell of [0, -1, Number.NaN]) {
      expect(solveCalibration({ ...base, unitsPerCell })).toEqual({
        ok: false,
        error: 'invalid-grid',
      });
    }
    expect(solveCalibration({ ...base, a: { x: Number.NaN, z: 0 } })).toMatchObject({
      ok: false,
    });
    expect(solveCalibration({ ...base, current: { ...base.current, scale: 0 } })).toEqual({
      ok: false,
      error: 'invalid-grid',
    });
  });

  it('property: the calibrated image puts the two points exactly `cells` apart in world space', () => {
    const rand = rng(42);
    for (let i = 0; i < 500; i++) {
      const input: CalibrationInput = {
        a: { x: rand() - 0.5, z: rand() - 0.5 },
        b: { x: rand() - 0.5, z: rand() - 0.5 },
        distance: 0.5 + rand() * 100,
        unit: rand() < 0.5 ? 'scene' : 'cells',
        unitsPerCell: 0.5 + rand() * 10,
        current: {
          position: { x: (rand() - 0.5) * 50, y: rand() * 3, z: (rand() - 0.5) * 50 },
          scale: 0.5 + rand() * 60,
        },
        anchor: rand() < 0.5 ? 'keep' : 'snap',
      };
      const r = solveCalibration(input);
      if (localDistance(input.a, input.b) < 1e-4) {
        expect(r.ok).toBe(false);
        continue;
      }
      if (!r.ok) throw new Error('expected ok');
      const wa = localToWorld(input.a, r.position, r.scale);
      const wb = localToWorld(input.b, r.position, r.scale);
      const worldCells = Math.hypot(wb.x - wa.x, wb.z - wa.z);
      expect(worldCells).toBeCloseTo(toCells(input.distance, input.unit, input.unitsPerCell), 6);
      expect(r.position.y).toBe(input.current.position.y);
      expect(r.scale).toBeGreaterThan(0);
    }
  });

  it('property: solving twice with the same measurement is idempotent in scale', () => {
    const rand = rng(7);
    for (let i = 0; i < 200; i++) {
      const a = { x: rand() - 0.5, z: rand() - 0.5 };
      const b = { x: a.x + 0.1 + rand() * 0.4, z: a.z + rand() * 0.1 };
      const first = solveCalibration({ ...base, a, b });
      if (!first.ok) throw new Error('expected ok');
      const second = solveCalibration({
        ...base,
        a,
        b,
        current: { position: first.position, scale: first.scale },
      });
      if (!second.ok) throw new Error('expected ok');
      expect(second.scale).toBeCloseTo(first.scale, 9);
      expect(second.position.x).toBeCloseTo(first.position.x, 6);
      expect(second.position.z).toBeCloseTo(first.position.z, 6);
    }
  });
});

describe('coordinate helpers', () => {
  it('worldToLocal inverts localToWorld', () => {
    const rand = rng(3);
    for (let i = 0; i < 200; i++) {
      const position = { x: rand() * 40 - 20, y: 0, z: rand() * 40 - 20 };
      const scale = 0.1 + rand() * 50;
      const p = { x: rand() - 0.5, z: rand() - 0.5 };
      const back = worldToLocal(localToWorld(p, position, scale), position, scale);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.z).toBeCloseTo(p.z, 9);
    }
  });

  it('derives a default scale and pixel density', () => {
    expect(defaultPlacementScale(1400)).toBe(20);
    expect(pixelsPerCell(1400, 20)).toBe(70);
  });
});
