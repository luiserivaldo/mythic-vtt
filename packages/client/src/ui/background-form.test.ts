import { describe, expect, it } from 'vitest';
import { backgroundDraft, isValidBackgroundDraft } from './background-form.js';
import { sceneBackgroundIntent, sceneSkyboxIntent } from './intent-specs.js';
import type { Campaign } from '@mythic/shared';

const campaign = {
  scenes: {
    s1: { environment: { background: '#abc', zenith: '#123456' } },
    s2: { environment: { background: 'x' } },
  },
} as unknown as Campaign;

describe('background form', () => {
  it('derives drafts with fallbacks', () => {
    expect(backgroundDraft(campaign, 's1')).toEqual({ background: '#aabbcc', zenith: '#123456' });
    expect(backgroundDraft(campaign, 's2')).toEqual({ background: '#d9dde3', zenith: '' });
    expect(backgroundDraft(campaign, 'none').zenith).toBe('');
  });
  it('validates and builds intent', () => {
    expect(isValidBackgroundDraft({ background: '#000000', zenith: '' })).toBe(true);
    expect(isValidBackgroundDraft({ background: '#000000', zenith: 'q' })).toBe(false);
    expect(sceneBackgroundIntent('s', '#000000', null).payload).toEqual({
      sceneId: 's',
      background: '#000000',
      zenith: null,
    });
  });
  it('builds the image skybox intent to set and clear it', () => {
    const asset = { source: 'local', hash: 'a'.repeat(64), kind: 'image' } as const;
    expect(sceneSkyboxIntent('s', asset).payload).toEqual({ sceneId: 's', skybox: asset });
    expect(sceneSkyboxIntent('s', null).payload).toEqual({ sceneId: 's', skybox: null });
  });
});
