import type { Transform } from '@mythic/shared';
import { createStore } from 'zustand/vanilla';
import type { GizmoDraft } from './transform-gizmo.js';

export interface GizmoPreview {
  sceneId: string;
  entityId: string;
  draft: GizmoDraft;
  /** The stored transform when the preview began; a different one means the host's patch landed. */
  base: Transform;
  /** Committed and waiting for the host's patch; the preview stays so the entity does not flick back. */
  settling: boolean;
}

interface GizmoState {
  preview: GizmoPreview | null;
  busy: boolean;
  error: string | null;
  begin(preview: Omit<GizmoPreview, 'settling'>): void;
  update(draft: GizmoDraft): void;
  settle(): void;
  clear(): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
}

/** Live drag preview is local-only visual state; it never enters the game action log (D34). */
export const gizmoStore = createStore<GizmoState>()((set) => ({
  preview: null,
  busy: false,
  error: null,
  begin: (preview) => {
    set({ preview: { ...preview, settling: false }, error: null });
  },
  update: (draft) => {
    set((s) => (s.preview ? { preview: { ...s.preview, draft } } : s));
  },
  settle: () => {
    set((s) => (s.preview ? { preview: { ...s.preview, settling: true } } : s));
  },
  clear: () => {
    set({ preview: null });
  },
  setBusy: (busy) => {
    set({ busy });
  },
  setError: (error) => {
    set({ error });
  },
}));
