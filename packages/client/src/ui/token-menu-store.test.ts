import { expect, it } from 'vitest';
import { tokenMenuStore } from './token-menu-store.js';

it('opens the full menu for one token at a time and closes it again (UI-TOKEN-02)', () => {
  const store = tokenMenuStore;
  expect(store.getState().entityId).toBeNull();
  store.getState().open('one');
  expect(store.getState().entityId).toBe('one');
  store.getState().open('two');
  expect(store.getState().entityId).toBe('two');
  store.getState().close();
  expect(store.getState().entityId).toBeNull();
});
