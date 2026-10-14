import { describe, expect, it } from 'vitest';
import { assetUrl } from './asset-url.js';

const hash = 'ab'.repeat(32);
const local = { source: 'local', hash, kind: 'image' } as const;

describe('assetUrl', () => {
  it('builds a same-origin route when there is no base', () => {
    expect(assetUrl('', local)).toBe(`/assets/${hash}`);
  });
  it('joins a host base without double slashes', () => {
    expect(assetUrl('http://host:8787/', local)).toBe(`http://host:8787/assets/${hash}`);
  });
  it('has no URL for missing or library refs', () => {
    expect(assetUrl('', undefined)).toBeNull();
    expect(
      assetUrl('', {
        source: 'library',
        libraryId: 'x',
        version: '1',
        kind: 'image',
        fallback: { kind: 'primitive' },
      }),
    ).toBeNull();
  });
});
