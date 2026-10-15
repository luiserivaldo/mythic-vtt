import type { Audience } from '@mythic/shared';
import { createStore } from 'zustand/vanilla';
import type { ImageUploader } from '../assets/image-upload.js';
import type { IntentSpec } from './intent-specs.js';
import type { Profile } from './join-screen.js';

/** UI-HOST-02: the sign-out capture is a list thumbnail, not a full-resolution board image. */
export const THUMBNAIL_BOX = { width: 640, height: 360 } as const;
/** Far above a 640x360 WebP; anything bigger means the encoder misbehaved, so it is not sent. */
export const THUMBNAIL_MAX_BYTES = 512 * 1024;
/** The types the host image pipeline accepts (`POST /assets/images`). */
export const THUMBNAIL_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Scales `width` x `height` down (never up) to fit the thumbnail box, keeping the aspect. */
export function fitThumbnail(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    THUMBNAIL_BOX.width / Math.max(width, 1),
    THUMBNAIL_BOX.height / Math.max(height, 1),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A capture may be uploaded only if it is a non-empty image within the byte budget. */
export function isUploadableThumbnail(blob: Pick<Blob, 'size' | 'type'>): boolean {
  return (
    blob.size > 0 &&
    blob.size <= THUMBNAIL_MAX_BYTES &&
    (THUMBNAIL_TYPES as readonly string[]).includes(blob.type)
  );
}

export const brandingIntent = (payload: {
  screenshot?: string | null;
  autoScreenshot?: string | null;
}): IntentSpec => ({ type: 'campaign.setBranding', payload });

/** The slice of the client store the capture drives: the DM's own audience preview (UX-14). */
export interface PreviewControl {
  getState(): {
    realIsHost: boolean;
    isHost: boolean;
    viewAs: Audience;
    spectatorSeatId: string | null;
  };
  setViewAs(audience: Audience): void;
  setSpectatorSource(seatId: string | null): void;
}

/**
 * UX-05 / PERM-03: the capture may end up on the public join screen, so the board is rendered
 * through the same `visibleTo` projection the host applies for the spectators audience, never
 * as the DM sees it: no DM layer, no DM-only scenes or hidden entities. If the preview cannot be
 * entered (not the DM, or intents still pending) nothing is captured. The DM's own preview
 * choice is put back afterwards.
 */
export async function capturePublicBoard(
  store: PreviewControl,
  render: () => Promise<Blob | null>,
): Promise<Blob | null> {
  const before = store.getState();
  if (!before.realIsHost) return null;
  store.setSpectatorSource(null);
  store.setViewAs({ kind: 'spectators' });
  try {
    const now = store.getState();
    if (now.viewAs.kind !== 'spectators' || now.isHost || now.spectatorSeatId !== null) return null;
    return await render();
  } finally {
    store.setSpectatorSource(before.spectatorSeatId);
    store.setViewAs(before.viewAs);
  }
}

export type SignOutOutcome = 'captured' | 'skipped' | 'failed';

/**
 * UI-HOST-02: the DM signs out. The capture is best effort: whatever happens to it, the DM is
 * signed out. It goes through the normal upload route, so it keeps the host's size, type and
 * permission limits, and is stored as `autoScreenshot` (the DM's upload still wins).
 */
export async function signOutWithThumbnail(deps: {
  capture: () => Promise<Blob | null>;
  upload: ImageUploader;
  send: (spec: IntentSpec) => Promise<boolean>;
  stop: () => void;
}): Promise<SignOutOutcome> {
  let outcome: SignOutOutcome = 'skipped';
  try {
    const blob = await deps.capture();
    if (blob && isUploadableThumbnail(blob)) {
      const { hash } = await deps.upload(blob);
      outcome = (await deps.send(brandingIntent({ autoScreenshot: hash }))) ? 'captured' : 'failed';
    }
  } catch {
    outcome = 'failed';
  }
  deps.stop();
  return outcome;
}

/** Set after the DM signs out: the table is replaced by a sign-back-in card. */
export const signOutStore = createStore<{
  signedOut: Pick<Profile, 'displayName' | 'avatar' | 'color'> | null;
}>()(() => ({ signedOut: null }));
