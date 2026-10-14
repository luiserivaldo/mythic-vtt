import { describe, expect, it } from 'vitest';
import { DEFAULT_3D_LIGHTING } from './lighting.js';

describe('default 3D lighting', () => {
  it('uses a restrained ambient and key-light palette', () => {
    expect(DEFAULT_3D_LIGHTING.ambientIntensity).toBeLessThan(1);
    expect(DEFAULT_3D_LIGHTING.directionalIntensity).toBeLessThanOrEqual(1);
    expect(DEFAULT_3D_LIGHTING.directionalPosition[1]).toBeGreaterThan(0);
  });
});
