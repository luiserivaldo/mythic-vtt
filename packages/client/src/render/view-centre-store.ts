import { createStore } from 'zustand/vanilla';

/**
 * UI-TOOL-04 (MV-266): where the middle of this client's view is on the ground, for screen chrome
 * outside the canvas (Create Prop places a new prop there). The mounted camera registers a reader,
 * so the point is taken at the moment it is asked for, never every frame. View state only.
 */
interface ViewCentreState {
  /** The ground point at the middle of the view, or null while no camera is mounted. */
  read: (() => { x: number; z: number }) | null;
}

export const viewCentreStore = createStore<ViewCentreState>()(() => ({ read: null }));

export function readViewCentre(): { x: number; z: number } | null {
  return viewCentreStore.getState().read?.() ?? null;
}
