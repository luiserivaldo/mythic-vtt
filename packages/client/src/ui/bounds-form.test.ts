import { describe, expect, it } from 'vitest';
import { makeCampaign } from '../testing.js';
import { boundsDraft, DEFAULT_BOUNDS_DRAFT, parseBoundsDraft } from './bounds-form.js';

describe('parseBoundsDraft (D37)', () => {
  it('accepts whole cells 1..200', () => {
    expect(parseBoundsDraft({ width: '1', height: '200' })).toEqual({ width: 1, height: 200 });
    expect(parseBoundsDraft(DEFAULT_BOUNDS_DRAFT)).toEqual({ width: 40, height: 30 });
  });
  it.each(['', '0', '201', '2.5', '-3', 'abc', '1e2'])('rejects %j', (bad) => {
    expect(parseBoundsDraft({ width: bad, height: '10' })).toBeNull();
    expect(parseBoundsDraft({ width: '10', height: bad })).toBeNull();
  });
});

describe('boundsDraft', () => {
  it('falls back to the defaults for an unknown scene and a scene without bounds', () => {
    const campaign = makeCampaign();
    expect(boundsDraft(campaign, 'missing')).toBe(DEFAULT_BOUNDS_DRAFT);
    const id = Object.keys(campaign.scenes)[0];
    if (id) expect(boundsDraft(campaign, id)).toEqual(DEFAULT_BOUNDS_DRAFT);
  });
});
