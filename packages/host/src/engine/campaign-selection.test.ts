import { describe, expect, it } from 'vitest';
import type { CampaignMeta } from '../storage/types.js';
import { CampaignSelectionError, selectCampaign } from './campaign.js';

const meta = (id: string, name: string, updatedAt: number): CampaignMeta => ({
  id,
  name,
  schemaVersion: 4,
  updatedAt,
});
const list = [
  meta('01J0000000000000000000ABCD', 'Curse of Strahd', 30),
  meta('01J0000000000000000000ABEF', 'Sunken Chapel', 20),
  meta('01J0000000000000000000XYZ1', 'sunken chapel', 10),
];
const store = (campaigns: CampaignMeta[]) => ({ list: () => Promise.resolve(campaigns) });

describe('selectCampaign (HOST-03)', () => {
  it('opens the newest campaign when nothing is chosen, the old single-host behaviour', async () => {
    expect(await selectCampaign(store(list))).toEqual({ id: list[0]?.id });
    expect(await selectCampaign(store([]))).toBeUndefined();
  });

  it('asks the picker only when there is a real choice', async () => {
    const asked: number[] = [];
    const choose = (campaigns: readonly CampaignMeta[]) => {
      asked.push(campaigns.length);
      return Promise.resolve(list[1]?.id);
    };
    expect(await selectCampaign(store(list), {}, choose)).toEqual({ id: list[1]?.id });
    expect(await selectCampaign(store([list[0] as CampaignMeta]), {}, choose)).toEqual({
      id: list[0]?.id,
    });
    expect(asked).toEqual([3]);
    expect(await selectCampaign(store(list), {}, () => Promise.resolve(undefined))).toEqual({
      id: list[0]?.id,
    });
  });

  it('selects by exact id, by unique name or by unique id prefix', async () => {
    expect(await selectCampaign(store(list), { campaignId: list[2]?.id as string })).toEqual({
      id: list[2]?.id,
    });
    expect(await selectCampaign(store(list), { campaign: 'curse of strahd' })).toEqual({
      id: list[0]?.id,
    });
    expect(await selectCampaign(store(list), { campaign: '01J0000000000000000000XYZ' })).toEqual({
      id: list[2]?.id,
    });
    expect(await selectCampaign(store(list), { campaign: list[1]?.id as string })).toEqual({
      id: list[1]?.id,
    });
  });

  it('refuses an unknown or ambiguous choice and lists what exists', async () => {
    await expect(selectCampaign(store(list), { campaignId: 'nope' })).rejects.toThrow(
      CampaignSelectionError,
    );
    await expect(selectCampaign(store(list), { campaign: 'Dragon Heist' })).rejects.toThrow(
      /Curse of Strahd/,
    );
    await expect(selectCampaign(store(list), { campaign: 'sunken chapel' })).rejects.toThrow(
      /matches several campaigns/,
    );
    await expect(selectCampaign(store(list), { campaign: '01J00000' })).rejects.toThrow(
      /matches several campaigns/,
    );
    await expect(selectCampaign(store([]), { campaign: 'x' })).rejects.toThrow(
      /no campaigns exist yet/,
    );
  });

  it('creates on request and rejects contradictory flags', async () => {
    expect(await selectCampaign(store(list), { newCampaign: ' Lost Mine ' })).toEqual({
      create: 'Lost Mine',
    });
    await expect(selectCampaign(store(list), { newCampaign: ' ' })).rejects.toThrow(/needs a name/);
    await expect(selectCampaign(store(list), { campaign: 'a', newCampaign: 'b' })).rejects.toThrow(
      /not several/,
    );
  });
});
