import { StatusIcon, type TokenStatusMarker } from '@mythic/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_VISIBLE_MARKERS,
  markerAnchor2d,
  markerAnchor3d,
  markerStrip,
  markerText,
  markerTitle,
  STATUS_ICON_GLYPHS,
  statusIconLabel,
} from './status-markers.js';
import { labelAnchor3d, standeeDimensions } from './token-standee.js';

const marker = (n: number): TokenStatusMarker => ({
  kind: 'icon',
  icon: StatusIcon.options[n % StatusIcon.options.length] ?? 'blinded',
});

describe('status marker glyphs (TOK-06)', () => {
  it('has a glyph for every icon the schema can carry', () => {
    for (const icon of StatusIcon.options) {
      expect(STATUS_ICON_GLYPHS[icon]).toBeTruthy();
    }
  });

  it('reads the same text in the picker and on the token', () => {
    expect(statusIconLabel('blinded')).toBe('Blinded');
    expect(statusIconLabel('exhaustion')).toBe('Exhaustion');
    expect(markerText({ kind: 'icon', icon: 'blinded' })).toBe(STATUS_ICON_GLYPHS.blinded);
    expect(markerText({ kind: 'text', text: 'Moon marked' })).toBe('Moon marked');
    expect(markerTitle({ kind: 'icon', icon: 'prone' })).toBe('Prone');
    expect(markerTitle({ kind: 'text', text: 'Moon marked' })).toBe('Moon marked');
  });
});

describe('markerStrip (TOK-06 render cap)', () => {
  it('shows nothing for a token without markers', () => {
    expect(markerStrip(undefined)).toEqual({ shown: [], overflow: 0 });
    expect(markerStrip([])).toEqual({ shown: [], overflow: 0 });
  });

  it('shows every marker up to the cap and summarises the rest', () => {
    const markers = Array.from({ length: MAX_VISIBLE_MARKERS }, (_, index) => marker(index));
    expect(markerStrip(markers).shown).toHaveLength(MAX_VISIBLE_MARKERS);
    expect(markerStrip(markers).overflow).toBe(0);
    // The schema caps a token at 32 markers; the strip must never draw them all.
    const many = Array.from({ length: 32 }, (_, index) => marker(index));
    const strip = markerStrip(many);
    expect(strip.shown).toHaveLength(MAX_VISIBLE_MARKERS);
    expect(strip.overflow).toBe(32 - MAX_VISIBLE_MARKERS);
    expect(strip.shown).toEqual(many.slice(0, MAX_VISIBLE_MARKERS));
  });

  it('clamps a malformed cap instead of throwing or overflowing', () => {
    const markers = [marker(0), marker(1)];
    expect(markerStrip(markers, 1).shown).toHaveLength(1);
    expect(markerStrip(markers, 0)).toEqual({ shown: [], overflow: 2 });
    expect(markerStrip(markers, -3)).toEqual({ shown: [], overflow: 2 });
    expect(markerStrip(markers, Number.NaN)).toEqual({ shown: [], overflow: 2 });
    expect(markerStrip(markers, Number.NEGATIVE_INFINITY)).toEqual({ shown: [], overflow: 2 });
    expect(markerStrip(markers, Number.POSITIVE_INFINITY).shown).toHaveLength(2);
    expect(markerStrip(markers, 1.9).shown).toHaveLength(1);
  });

  it('always draws a prefix of the list and never loses a marker', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 32 }),
        fc.double({ min: -5, max: 40, noNaN: true }),
        (picks, max) => {
          const markers = picks.map(marker);
          const strip = markerStrip(markers, max);
          expect(strip.shown).toEqual(markers.slice(0, strip.shown.length));
          expect(strip.shown.length + strip.overflow).toBe(markers.length);
          expect(strip.shown.length).toBeLessThanOrEqual(Math.max(0, Math.floor(max)));
        },
      ),
    );
  });
});

describe('marker anchors', () => {
  it('sits on the token footprint corner in 2D and moves with the footprint', () => {
    expect(markerAnchor2d(1)).toEqual([0.5, 0.5, 0]);
    expect(markerAnchor2d(4)[0]).toBeCloseTo(2);
    // Malformed sizes fall back to one cell, exactly like the token mesh.
    expect(markerAnchor2d(Number.NaN)).toEqual(markerAnchor2d(1));
    expect(markerAnchor2d(-2)).toEqual(markerAnchor2d(1));
    expect(markerAnchor2d(undefined)).toEqual(markerAnchor2d(1));
  });

  it('sits at the top-right of the 3D standee, clear of the name label', () => {
    const [x, y, z] = markerAnchor3d(1);
    const dims = standeeDimensions(1);
    expect(x).toBeCloseTo(dims.width / 2);
    expect(y).toBeCloseTo(dims.baseThickness + dims.height);
    expect(z).toBe(0);
    // The centred name label is above that height, so the two overlay anchors differ.
    expect(y).toBeLessThan(labelAnchor3d(1)[1]);
  });
});
