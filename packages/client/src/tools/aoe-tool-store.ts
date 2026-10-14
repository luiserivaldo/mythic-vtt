import { createStore } from 'zustand/vanilla';
import { DEFAULT_AOE_DRAFT, type AoEDraft } from './aoe-placement.js';

interface AoEToolState {
  active: boolean;
  editingEntityId: string | null;
  draft: AoEDraft;
  preview: AoEDraft | null;
  busy: boolean;
  error: string | null;
  setActive(active: boolean): void;
  setEditingEntityId(entityId: string | null): void;
  setDraft(patch: Partial<AoEDraft>): void;
  setPreview(preview: AoEDraft | null): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
}

export const aoeToolStore = createStore<AoEToolState>()((set) => ({
  active: false,
  editingEntityId: null,
  draft: DEFAULT_AOE_DRAFT,
  preview: null,
  busy: false,
  error: null,
  setActive: (active) => {
    set({ active, editingEntityId: null, preview: null });
  },
  setEditingEntityId: (editingEntityId) => {
    set({ active: false, editingEntityId, preview: null });
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
