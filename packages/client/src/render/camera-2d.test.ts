import { describe, expect, it } from 'vitest';
import {
  applyWheel,
  classifyWheel,
  clampViewToBounds,
  clampZoom,
  frameBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  PAN_MARGIN_CELLS,
  panByPixels,
  pinchUpdate,
  screenToWorld,
  zoomAboutPoint,
  type View2D,
} from './camera-2d.js';

const viewport = { width: 800, height: 600 };
const view: View2D = { centerX: 3, centerZ: -2, zoom: 48 };

describe('camera-2d', () => {
  it('clamps zoom and rejects non-finite values', () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(10_000)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(48);
  });

  it('pans so content follows the pointer', () => {
    const next = panByPixels(view, 48, -96);
    expect(next.centerX).toBeCloseTo(2);
    expect(next.centerZ).toBeCloseTo(0);
  });

  it('keeps the world point under the cursor fixed when zooming', () => {
    const anchor = { x: 200, y: 450 };
    const before = screenToWorld(view, viewport, anchor);
    const next = zoomAboutPoint(view, viewport, anchor, 1.7);
    const after = screenToWorld(next, viewport, anchor);
    expect(next.zoom).toBeCloseTo(48 * 1.7);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('does not move the view when already at a zoom bound', () => {
    const atMax = { ...view, zoom: MAX_ZOOM };
    expect(zoomAboutPoint(atMax, viewport, { x: 10, y: 10 }, 2)).toBe(atMax);
  });

  it('ignores invalid zoom factors', () => {
    expect(zoomAboutPoint(view, viewport, { x: 0, y: 0 }, 0)).toBe(view);
    expect(zoomAboutPoint(view, viewport, { x: 0, y: 0 }, Number.NaN)).toBe(view);
  });

  it('pinch spreading zooms in about the midpoint', () => {
    const prev = [
      { x: 300, y: 300 },
      { x: 500, y: 300 },
    ] as const;
    const next = [
      { x: 200, y: 300 },
      { x: 600, y: 300 },
    ] as const;
    const mid = screenToWorld(view, viewport, { x: 400, y: 300 });
    const out = pinchUpdate(view, viewport, prev, next);
    expect(out.zoom).toBeCloseTo(96);
    const after = screenToWorld(out, viewport, { x: 400, y: 300 });
    expect(after.x).toBeCloseTo(mid.x);
    expect(after.y).toBeCloseTo(mid.y);
  });

  it('pinch with moving midpoint also pans', () => {
    const prev = [
      { x: 300, y: 300 },
      { x: 500, y: 300 },
    ] as const;
    const next = [
      { x: 348, y: 300 },
      { x: 548, y: 300 },
    ] as const;
    const out = pinchUpdate(view, viewport, prev, next);
    expect(out.zoom).toBe(48);
    expect(out.centerX).toBeCloseTo(2);
  });

  it('classifies wheel input', () => {
    expect(classifyWheel({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false }).kind).toBe(
      'zoom',
    );
    expect(classifyWheel({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false }).kind).toBe('zoom');
    expect(classifyWheel({ deltaX: 4, deltaY: 7, deltaMode: 0, ctrlKey: false }).kind).toBe('pan');
    expect(classifyWheel({ deltaX: 0, deltaY: 12.5, deltaMode: 0, ctrlKey: false }).kind).toBe(
      'pan',
    );
    expect(classifyWheel({ deltaX: 0, deltaY: 5, deltaMode: 0, ctrlKey: true }).kind).toBe('zoom');
  });

  it('wheel up zooms in, wheel down zooms out, and steps are bounded', () => {
    const up = classifyWheel({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false });
    const down = classifyWheel({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false });
    const huge = classifyWheel({ deltaX: 0, deltaY: 1e6, deltaMode: 0, ctrlKey: false });
    expect(up.kind === 'zoom' && up.factor > 1).toBe(true);
    expect(down.kind === 'zoom' && down.factor < 1).toBe(true);
    expect(huge.kind === 'zoom' && huge.factor >= Math.exp(-0.5)).toBe(true);
  });

  it('trackpad scroll pans content with the fingers', () => {
    const g = classifyWheel({ deltaX: 0, deltaY: 10, deltaMode: 0, ctrlKey: false });
    const next = applyWheel(view, viewport, { x: 0, y: 0 }, g);
    expect(next.zoom).toBe(48);
    expect(next.centerZ).toBeGreaterThan(view.centerZ);
  });

  it('zoom in then out about the same point round-trips', () => {
    const anchor = { x: 123, y: 321 };
    const there = zoomAboutPoint(view, viewport, anchor, 2);
    const back = zoomAboutPoint(there, viewport, anchor, 0.5);
    expect(back.zoom).toBeCloseTo(view.zoom);
    expect(back.centerX).toBeCloseTo(view.centerX);
    expect(back.centerZ).toBeCloseTo(view.centerZ);
  });
});

describe('canvas bounds (D37)', () => {
  const b = { width: 40, height: 30 };
  it('clamps the centre to the canvas plus margin', () => {
    const v = clampViewToBounds({ centerX: -100, centerZ: 500, zoom: 48 }, b);
    expect(v).toEqual({ centerX: -PAN_MARGIN_CELLS, centerZ: 30 + PAN_MARGIN_CELLS, zoom: 48 });
    const inside = { centerX: 10, centerZ: 5, zoom: 20 };
    expect(clampViewToBounds(inside, b)).toEqual(inside);
  });
  it('frames the whole canvas centred', () => {
    const v = frameBounds({ width: 800, height: 600 }, b);
    expect(v.centerX).toBe(20);
    expect(v.centerZ).toBe(15);
    expect(v.zoom * (b.width + 2)).toBeLessThanOrEqual(800 + 1e-9);
    expect(v.zoom * (b.height + 2)).toBeLessThanOrEqual(600 + 1e-9);
  });
});
