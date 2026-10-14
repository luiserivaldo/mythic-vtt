import { describe, expect, it } from 'vitest';
import { elevationBadgeText } from './elevation-badge.js';

// UI-TOKEN-05: the 2D elevation badge text. The "Show height labels" viewer setting hides the
// text; the 3D drop line and shadow are drawn elsewhere (DropLines) and are never affected.

const grid = { unitsPerCell: 5, unitLabel: 'ft' };

describe('elevationBadgeText (UI-TOKEN-05)', () => {
  it('formats the height in scene units above and below ground', () => {
    expect(elevationBadgeText(2, grid, false, true)).toBe('+10 ft');
    expect(elevationBadgeText(-1, grid, false, true)).toBe('-5 ft');
    expect(elevationBadgeText(0.5, grid, false, true)).toBe('+2.5 ft');
    expect(elevationBadgeText(1000, grid, false, true)).toBe('+5000 ft');
    expect(elevationBadgeText(-1000, grid, false, true)).toBe('-5000 ft');
  });

  it('shows no badge at ground level unless the token is flying', () => {
    expect(elevationBadgeText(0, grid, false, true)).toBeNull();
    expect(elevationBadgeText(-0, grid, false, true)).toBeNull();
    expect(elevationBadgeText(1e-9, grid, false, true)).toBeNull();
    expect(elevationBadgeText(0, grid, true, true)).toBe('✈ Flying');
  });

  it('marks a flying token alongside its height', () => {
    expect(elevationBadgeText(2, grid, true, true)).toBe('✈ Flying +10 ft');
    expect(elevationBadgeText(-2, grid, true, true)).toBe('✈ Flying -10 ft');
  });

  it('hides the badge text entirely when the viewer turned height labels off', () => {
    expect(elevationBadgeText(2, grid, false, false)).toBeNull();
    expect(elevationBadgeText(-1, grid, false, false)).toBeNull();
    expect(elevationBadgeText(2, grid, true, false)).toBeNull();
    expect(elevationBadgeText(0, grid, true, false)).toBeNull();
  });

  it('omits the unit label when the scene has none, or only blank space', () => {
    expect(elevationBadgeText(1, { unitsPerCell: 1, unitLabel: '' }, false, true)).toBe('+1');
    expect(elevationBadgeText(1, { unitsPerCell: 1, unitLabel: '   ' }, false, true)).toBe('+1');
  });
});
