/**
 * Pure 2D camera maths (CAM-01). No DOM or Three.js here so it is unit-testable.
 *
 * The 2D camera looks straight down with screen-right = +X and screen-down = +Z
 * (grid X -> world X, grid Y -> world Z, 1 unit = 1 cell).
 * `zoom` is pixels per grid cell, which equals the orthographic camera's zoom.
 */

export interface View2D {
  /** World X at the viewport centre. */
  readonly centerX: number;
  /** World Z at the viewport centre. */
  readonly centerZ: number;
  /** Pixels per grid cell. */
  readonly zoom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export const MIN_ZOOM = 8;
export const MAX_ZOOM = 256;
export const DEFAULT_ZOOM = 48;

export const DEFAULT_VIEW: View2D = { centerX: 0, centerZ: 0, zoom: DEFAULT_ZOOM };

/** Pointer movement (px) before a press becomes a drag-pan, so plain clicks still reach picking. */
export const DRAG_THRESHOLD_PX = 4;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Screen pixel (relative to the viewport's top-left) to world X/Z. */
export function screenToWorld(view: View2D, viewport: Viewport, p: Point): Point {
  return {
    x: view.centerX + (p.x - viewport.width / 2) / view.zoom,
    y: view.centerZ + (p.y - viewport.height / 2) / view.zoom,
  };
}

/** Pan by a screen-space drag delta: content follows the pointer. */
export function panByPixels(view: View2D, dx: number, dy: number): View2D {
  return {
    ...view,
    centerX: view.centerX - dx / view.zoom,
    centerZ: view.centerZ - dy / view.zoom,
  };
}

/** Multiply zoom by `factor` (clamped), keeping the world point under `anchor` fixed on screen. */
export function zoomAboutPoint(
  view: View2D,
  viewport: Viewport,
  anchor: Point,
  factor: number,
): View2D {
  if (!Number.isFinite(factor) || factor <= 0) return view;
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const world = screenToWorld(view, viewport, anchor);
  return {
    zoom,
    centerX: world.x - (anchor.x - viewport.width / 2) / zoom,
    centerZ: world.y - (anchor.y - viewport.height / 2) / zoom,
  };
}

/** Two-pointer pinch: zoom by the change in finger distance and pan by the midpoint movement. */
export function pinchUpdate(
  view: View2D,
  viewport: Viewport,
  prev: readonly [Point, Point],
  next: readonly [Point, Point],
): View2D {
  const prevDist = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
  const nextDist = Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y);
  const prevMid = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
  const nextMid = { x: (next[0].x + next[1].x) / 2, y: (next[0].y + next[1].y) / 2 };
  const factor = prevDist > 0 && nextDist > 0 ? nextDist / prevDist : 1;
  const zoomed = zoomAboutPoint(view, viewport, prevMid, factor);
  return panByPixels(zoomed, nextMid.x - prevMid.x, nextMid.y - prevMid.y);
}

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** WheelEvent.deltaMode: 0 pixel, 1 line, 2 page. */
  readonly deltaMode: number;
  /** Browsers report trackpad pinch as a wheel event with ctrlKey set. */
  readonly ctrlKey: boolean;
}

export type WheelGesture =
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number };

const LINE_PX = 16;
const PAGE_PX = 400;
const PINCH_SENSITIVITY = 0.01;
const WHEEL_SENSITIVITY = 0.0015;
const MAX_ZOOM_STEP = 0.5; // cap |ln factor| per event so one huge notch can't jump the view

function toPixels(value: number, mode: number): number {
  return mode === 1 ? value * LINE_PX : mode === 2 ? value * PAGE_PX : value;
}

/**
 * Classify a wheel event. Pinch (ctrlKey) and notched mouse wheels zoom;
 * smooth pixel-delta events (two-finger trackpad scroll) pan.
 * Heuristic, since browsers do not expose the device: a pixel-mode event with a
 * horizontal component, a fractional delta or a small delta is a trackpad.
 */
export function classifyWheel(input: WheelInput): WheelGesture {
  const { deltaX, deltaY, deltaMode, ctrlKey } = input;
  const dy = toPixels(deltaY, deltaMode);
  const dx = toPixels(deltaX, deltaMode);
  if (ctrlKey) {
    return { kind: 'zoom', factor: zoomFactor(dy, PINCH_SENSITIVITY) };
  }
  const trackpad = deltaMode === 0 && (dx !== 0 || !Number.isInteger(dy) || Math.abs(dy) < 40);
  if (trackpad) {
    // Scrolling moves content the way the fingers move, like a drag.
    return { kind: 'pan', dx: -dx, dy: -dy };
  }
  return { kind: 'zoom', factor: zoomFactor(dy, WHEEL_SENSITIVITY) };
}

function zoomFactor(deltaPx: number, sensitivity: number): number {
  const step = Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, -deltaPx * sensitivity));
  return Math.exp(step);
}

/** Apply a classified wheel gesture at a cursor position. */
export function applyWheel(
  view: View2D,
  viewport: Viewport,
  cursor: Point,
  gesture: WheelGesture,
): View2D {
  return gesture.kind === 'zoom'
    ? zoomAboutPoint(view, viewport, cursor, gesture.factor)
    : panByPixels(view, gesture.dx, gesture.dy);
}

/** Cells of empty space the centre may travel beyond the canvas edge (D37). */
export const PAN_MARGIN_CELLS = 3;

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * D37: keep the view centre within the canvas plus a margin, so the board can never be
 * panned fully off screen.
 */
export function clampViewToBounds(
  view: View2D,
  bounds: CanvasSize,
  margin = PAN_MARGIN_CELLS,
): View2D {
  const clamp = (v: number, hi: number) =>
    Math.min(hi + margin, Math.max(-margin, Number.isFinite(v) ? v : hi / 2));
  return {
    ...view,
    centerX: clamp(view.centerX, bounds.width),
    centerZ: clamp(view.centerZ, bounds.height),
  };
}

/** D37: the view that shows the whole canvas, with a little padding, centred. */
export function frameBounds(viewport: Viewport, bounds: CanvasSize, paddingCells = 1): View2D {
  const zoom = Math.min(
    viewport.width / (bounds.width + paddingCells * 2),
    viewport.height / (bounds.height + paddingCells * 2),
  );
  return {
    centerX: bounds.width / 2,
    centerZ: bounds.height / 2,
    zoom: clampZoom(Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_ZOOM),
  };
}
