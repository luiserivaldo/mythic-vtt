import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_ZENITH,
  domeColors,
  gradientAt,
  isValidColor,
  parseColor,
  resolveBackground,
  resolveColor,
  toHex,
} from './skybox-model.js';

describe('skybox-model', () => {
  it('parses hex colours', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#102030')).toEqual([16, 32, 48]);
    expect(parseColor('red')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
    expect(isValidColor('#abc')).toBe(true);
    expect(isValidColor('')).toBe(false);
  });
  it('round-trips and falls back', () => {
    expect(toHex([16, 32, 48])).toBe('#102030');
    expect(resolveColor('#ABC')).toBe('#aabbcc');
    expect(resolveColor('nonsense')).toBe(DEFAULT_BACKGROUND);
  });
  it('treats a missing or bad zenith as a plain colour', () => {
    expect(resolveBackground('#000000', undefined)).toEqual({ horizon: '#000000', zenith: null });
    expect(resolveBackground('#000000', 'bad').zenith).toBeNull();
    expect(resolveBackground('#000000', '#fff').zenith).toBe('#ffffff');
  });
  it('uses the light board and blue zenith defaults without overriding explicit colours', () => {
    expect(resolveBackground(undefined, undefined)).toEqual({
      horizon: DEFAULT_BACKGROUND,
      zenith: DEFAULT_ZENITH,
    });
    expect(resolveBackground(DEFAULT_BACKGROUND, undefined).zenith).toBe(DEFAULT_ZENITH);
    expect(resolveBackground('#112233', undefined)).toEqual({ horizon: '#112233', zenith: null });
    expect(resolveBackground('#112233', '#445566')).toEqual({
      horizon: '#112233',
      zenith: '#445566',
    });
  });
  it('interpolates horizon to zenith and clamps', () => {
    const spec = resolveBackground('#000000', '#ffffff');
    expect(gradientAt(spec, 0)).toEqual([0, 0, 0]);
    expect(gradientAt(spec, 1)).toEqual([255, 255, 255]);
    expect(gradientAt(spec, 0.5)[0]).toBeCloseTo(127.5);
    expect(gradientAt(spec, -1)).toEqual([0, 0, 0]);
    expect(gradientAt(spec, 5)).toEqual([255, 255, 255]);
    expect(gradientAt(spec, Number.NaN)).toEqual([0, 0, 0]);
  });
  it('produces vertex colours', () => {
    const c = domeColors(resolveBackground('#000000', '#ffffff'), [0, 1]);
    expect([...c]).toEqual([0, 0, 0, 1, 1, 1]);
    expect([...domeColors(resolveBackground('#ff0000', undefined), [0.7])]).toEqual([1, 0, 0]);
  });
});
