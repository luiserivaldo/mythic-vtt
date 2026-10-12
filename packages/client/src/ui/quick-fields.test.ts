import { expect, it } from 'vitest';
import { makeEntity, makeCampaign, IDS } from '../../../shared/src/actions/testing.js';
import {
  loadQuickFieldSelection,
  saveQuickFieldSelection,
  quickFieldPreview,
} from './quick-fields.js';

it('persists three distinct registry ids separately per viewer and tolerates broken storage', () => {
  const entries = new Map<string, string>();
  const store = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
  expect(saveQuickFieldSelection(store, 'one', ['speed', 'hp', 'ac'])).toBe(true);
  expect(loadQuickFieldSelection(store, 'one')).toEqual(['speed', 'hp', 'ac']);
  expect(loadQuickFieldSelection(store, 'two')).toEqual(['hp', 'ac', 'speed']);
  for (const selection of [['hp'], ['hp', 'hp', 'ac'], ['hp', 'ac', 'unknown']])
    expect(saveQuickFieldSelection(store, 'one', selection)).toBe(false);
  const unavailable = {
    getItem: () => {
      throw new Error('disabled');
    },
    setItem: () => {
      throw new Error('disabled');
    },
  };
  expect(loadQuickFieldSelection(unavailable, 'one')).toEqual(['hp', 'ac', 'speed']);
  expect(saveQuickFieldSelection(unavailable, 'one', ['hp', 'ac', 'speed'])).toBe(false);
});

it('renders absent fields as not shared and preserves zero values and colours', () => {
  const entity = makeEntity(IDS.entity, {
    token: {
      sizeCells: 1,
      heightCells: 1,
      labelVisibility: 'all',
      quickFields: { hp: { value: 0, visibility: 'all', color: '#abcdef' } },
    },
  });
  const grid = makeCampaign().scenes[IDS.scene]?.grid;
  if (!grid) throw new Error('fixture scene');
  const rows = quickFieldPreview(entity, ['hp', 'ac', 'speed'], 'host', null, grid);
  expect(rows[0]).toMatchObject({ value: 0, text: '0', color: '#abcdef' });
  expect(rows.slice(1).map((row) => row.text)).toEqual(['not shared', 'not shared']);
  expect(
    quickFieldPreview(entity, ['hp', 'ac', 'speed'], 'player', null, grid).every(
      (row) => row.value === null,
    ),
  ).toBe(true);
});
