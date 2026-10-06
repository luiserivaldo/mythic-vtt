import { describe, expect, it } from 'vitest';
import {
  elevationFromUnits,
  elevationStep,
  formatElevation,
  formatUnits,
  nextElevation,
} from './elevation.js';

const snap = { snap: true, unitsPerCell: 5, unitLabel: 'ft' };
const free = { ...snap, snap: false };

describe('elevation maths (D25)', () => {
  it('steps one cell when snapping, 0.1 otherwise, 5 with Shift', () => {
    expect(elevationStep(snap, false)).toBe(1);
    expect(elevationStep(free, false)).toBe(0.1);
    expect(elevationStep(snap, true)).toBe(5);
    expect(elevationStep(free, true)).toBe(5);
  });

  it('moves to the next stop and snaps off-grid heights', () => {
    expect(nextElevation(0, snap, 1, false)).toBe(1);
    expect(nextElevation(0, snap, -1, false)).toBe(-1);
    expect(nextElevation(2.4, snap, 1, false)).toBe(3);
    expect(nextElevation(2.4, snap, -1, false)).toBe(2);
    expect(nextElevation(3, snap, 1, true)).toBe(5);
    expect(nextElevation(0.2, free, 1, false)).toBe(0.3);
    expect(nextElevation(0.3, free, -1, false)).toBe(0.2);
  });

  it('clamps to the action range', () => {
    expect(nextElevation(1000, snap, 1, false)).toBe(1000);
    expect(nextElevation(-999, snap, -1, true)).toBe(-1000);
  });

  it('converts typed scene units to cells', () => {
    expect(elevationFromUnits(10, snap)).toBe(2);
    expect(elevationFromUnits(12, snap)).toBe(2);
    expect(elevationFromUnits(12, free)).toBe(2.4);
    expect(elevationFromUnits(-5, snap)).toBe(-1);
    expect(elevationFromUnits(5001, snap)).toBeNull();
    expect(elevationFromUnits(Number.NaN, snap)).toBeNull();
  });

  it('formats in scene units and hides ground level', () => {
    expect(formatElevation(2, snap)).toBe('+10 ft');
    expect(formatElevation(-1, snap)).toBe('-5 ft');
    expect(formatElevation(0.5, { unitsPerCell: 5, unitLabel: 'ft' })).toBe('+2.5 ft');
    expect(formatElevation(0, snap)).toBeNull();
    expect(formatElevation(1e-9, snap)).toBeNull();
    expect(formatElevation(1, { unitsPerCell: 1, unitLabel: '' })).toBe('+1');
    expect(formatUnits(-0.0000001, 5)).toBe('0');
  });
});
