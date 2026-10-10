import { expect, it } from 'vitest';
import { viewedCampaign } from './viewed-campaign.js';
import { makeCampaign } from '../testing.js';

it('browses locally for admins and follows shared activation for players', () => {
  const campaign = makeCampaign();
  const id = 'private';
  const scene = {
    id,
    name: 'Secret',
    dmOnly: true,
    entities: {},
    layers: {},
    environment: { background: '#ffffff' },
    grid: {
      type: 'square' as const,
      sizePx: 70,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'alternating' as const,
      snap: true,
    },
  };
  campaign.scenes[id] = scene;
  const before = structuredClone(campaign);
  expect(viewedCampaign(campaign, true, id)?.activeSceneId).toBe(id);
  expect(viewedCampaign(campaign, false, id)).toBe(campaign);
  expect(viewedCampaign(campaign, true, 'deleted')).toBe(campaign);
  expect(campaign).toEqual(before);
});
