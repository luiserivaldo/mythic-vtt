import { describe, expect, it } from 'vitest';
import type { RenderEntity } from './scene-model.js';
import { entityFill } from './token-fill.js';

const base: RenderEntity = {
  id: 'e',
  layer: 'tokens',
  position: [0, 0, 0],
  sizeCells: 1,
  secret: false,
  token: {
    image: undefined,
    name: 'T',
    owners: [],
    entityLayer: 'tokens',
    perms: undefined,
    labelVisibility: 'all',
  },
};
const withToken = (patch: Partial<NonNullable<RenderEntity['token']>>): RenderEntity => ({
  ...base,
  token: { ...(base.token as NonNullable<RenderEntity['token']>), ...patch },
});

describe('entityFill', () => {
  it('uses the token colour for an image-less token and rings it when selected', () => {
    expect(entityFill(withToken({ color: '#aa3300' }), false)).toEqual({
      color: '#aa3300',
      ring: false,
    });
    expect(entityFill(withToken({ color: '#aa3300' }), true)).toEqual({
      color: '#aa3300',
      ring: true,
    });
  });
  it('keeps the legacy placeholder when no colour is set', () => {
    expect(entityFill(base, false).color).toBe('#0e7490');
    expect(entityFill(base, true)).toEqual({ color: '#9f1239', ring: false });
  });
  it('ignores a malformed colour and ignores colour when an image exists', () => {
    expect(entityFill(withToken({ color: 'red' }), false).color).toBe('#0e7490');
    const image = { source: 'local', hash: 'h', kind: 'image', name: 'n' } as const;
    expect(entityFill(withToken({ color: '#aa3300', image }), false).color).toBe('#0e7490');
  });
});
