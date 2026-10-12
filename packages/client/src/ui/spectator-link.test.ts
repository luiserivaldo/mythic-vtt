import { expect, it } from 'vitest';
import { spectatorUrl } from './spectator-link.js';

it('keeps the credential only in the fragment and preserves a hosted subpath', () => {
  const token = 'x'.repeat(43);
  const url = new URL(spectatorUrl('https://table.example/play/?room=one', token));
  expect(url.pathname).toBe('/play/');
  expect(url.search).toBe('?room=one');
  expect(new URLSearchParams(url.hash.slice(1)).get('watch')).toBe(token);
});
