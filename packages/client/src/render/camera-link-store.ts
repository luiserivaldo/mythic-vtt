import { createStore } from 'zustand/vanilla';

/**
 * M4-11 (CAM-06): the two controls the camera link needs to share across the tree.
 *
 * Neither is campaign state (Pillar 1): the pull is one DM gesture and following is one viewer's
 * choice, so both live in a client store and never reach the action log.
 */
interface CameraLinkState {
  /** Bumped by the DM's "Pull players to my view"; one press sends exactly one pull. */
  pullToken: number;
  /** This spectator mirrors the DM's camera while it moves. Only a spectator may set it. */
  following: boolean;
  requestPull(): void;
  setFollowing(following: boolean): void;
}

export const cameraLinkStore = createStore<CameraLinkState>()((set, get) => ({
  pullToken: 0,
  following: false,
  requestPull() {
    set({ pullToken: get().pullToken + 1 });
  },
  setFollowing(following) {
    set({ following });
  },
}));
