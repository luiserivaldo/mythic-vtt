import { createStore } from 'zustand/vanilla';
import type { Local2 } from './battlemap-calibration.js';

interface CalibrationSession {
  entityId: string | null;
  /** Picked points in image-local coordinates (at most two). */
  points: readonly Local2[];
  start(entityId: string): void;
  addPoint(entityId: string, point: Local2): void;
  resetPoints(): void;
  cancel(): void;
}

const NO_POINTS: readonly Local2[] = [];

/** Calibration picking is local UI state; only the final entity.update intent reaches the host. */
export const calibrationStore = createStore<CalibrationSession>()((set, get) => ({
  entityId: null,
  points: NO_POINTS,
  start(entityId) {
    set({ entityId, points: NO_POINTS });
  },
  addPoint(entityId, point) {
    const current = get();
    if (current.entityId !== entityId) return;
    // A third click starts a new pair, so a misclick is recoverable without a button.
    set({ points: current.points.length >= 2 ? [point] : [...current.points, point] });
  },
  resetPoints() {
    set({ points: NO_POINTS });
  },
  cancel() {
    set({ entityId: null, points: NO_POINTS });
  },
}));
