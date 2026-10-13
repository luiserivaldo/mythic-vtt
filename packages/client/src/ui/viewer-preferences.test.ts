import { expect, it } from 'vitest';
import {
  createViewerPreferencesStore,
  loadViewerPreferences,
  viewerPreferencesKey,
} from './viewer-preferences.js';

it('isolates viewer preferences, survives reload, and rejects malformed storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const viewer = createViewerPreferencesStore(storage, 'one');
  viewer.getState().update({ showHeightLabels: false, confirmBeforeDeleting: false });
  expect(loadViewerPreferences(storage, 'one')).toEqual({
    showHeightLabels: false,
    confirmBeforeDeleting: false,
  });
  expect(loadViewerPreferences(storage, 'two')).toEqual({
    showHeightLabels: true,
    confirmBeforeDeleting: true,
  });
  for (const corrupt of [
    '{',
    '{"showHeightLabels":"false","confirmBeforeDeleting":false}',
    '{"showHeightLabels":false}',
    '{"showHeightLabels":false,"confirmBeforeDeleting":false,"extra":true}',
  ]) {
    values.set(viewerPreferencesKey('one'), corrupt);
    expect(loadViewerPreferences(storage, 'one')).toEqual({
      showHeightLabels: true,
      confirmBeforeDeleting: true,
    });
  }
});

it('keeps the current viewer usable when browser storage is unavailable', () => {
  const storage = {
    getItem: () => {
      throw new Error('disabled');
    },
    setItem: () => {
      throw new Error('disabled');
    },
  };
  const viewer = createViewerPreferencesStore(storage, 'one');
  viewer.getState().update({ confirmBeforeDeleting: false });
  expect(viewer.getState().preferences).toEqual({
    showHeightLabels: true,
    confirmBeforeDeleting: false,
  });
  expect(() => {
    viewer
      .getState()
      .update({ showHeightLabels: 'false' } as unknown as { showHeightLabels: boolean });
  }).toThrow();
  expect(viewer.getState().preferences.showHeightLabels).toBe(true);
});
