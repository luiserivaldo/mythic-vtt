import { createStore } from 'zustand/vanilla';
import { DEFAULT_AOE_DRAFT, type AoEDraft } from './aoe-placement.js';

interface AoEToolState {
  active: boolean;
  draft: AoEDraft;
  preview: AoEDraft | null;
  busy: boolean;
  error: string | null;
  setActive(active: boolean): void;
  setDraft(patch: Partial<AoEDraft>): void;
  setPreview(preview: AoEDraft | null): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
}

export const aoeToolStore = createStore<AoEToolState>()((set) => ({
  active: false,
  draft: DEFAULT_AOE_DRAFT,
  preview: null,
  busy: false,
  error: null,
  setActive: (active) => {
    set({ active, preview: null });
  },
  setDraft: (patch) => {
    set((s) => ({ draft: { ...s.draft, ...patch } }));
  },
  setPreview: (preview) => {
    set({ preview });
  },
  setBusy: (busy) => {
    set({ busy });
  },
  setError: (error) => {
    set({ error });
  },
}));
