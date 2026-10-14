import { expect, it, beforeEach } from 'vitest';
import { tokenMenuStore } from './token-menu-store.js';

beforeEach(() => {
  tokenMenuStore.getState().close();
});

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

it('keeps one menu open at a time, whichever was opened last (UI-TOKEN-02/03)', () => {
  const store = tokenMenuStore;
  store.getState().open('token');
  store.getState().openContext('token');
  expect(store.getState()).toMatchObject({ entityId: null, contextEntityId: 'token' });
  store.getState().open('token');
  expect(store.getState()).toMatchObject({ entityId: 'token', contextEntityId: null });
});

it('closes a menu whose token is no longer selected (PERM-01 view state)', () => {
  const store = tokenMenuStore;
  store.getState().open('one');
  store.getState().reconcile(['two']);
  expect(store.getState().entityId).toBeNull();
  store.getState().open('one');
  store.getState().reconcile(['one', 'two']);
  expect(store.getState().entityId).toBe('one');
  store.getState().openContext('two');
  store.getState().reconcile(['one', 'two']);
  expect(store.getState()).toMatchObject({ entityId: null, contextEntityId: 'two' });
  store.getState().reconcile(['one']);
  expect(store.getState()).toMatchObject({ entityId: null, contextEntityId: null });
});

it('closes everything when the selection empties', () => {
  const store = tokenMenuStore;
  store.getState().open('one');
  store.getState().reconcile([]);
  expect(store.getState()).toMatchObject({ entityId: null, contextEntityId: null });
});
