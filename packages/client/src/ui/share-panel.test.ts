import { describe, expect, it, vi } from 'vitest';
import { copyJoinUrl, playerVisibleUrl } from './share-panel.js';

describe('player join links', () => {
  it('removes fragments before display or copy', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const reported = 'https://table.example/play/#private';
    expect(playerVisibleUrl(reported)).toBe('https://table.example/play/');
    await copyJoinUrl(reported, { writeText });
    expect(writeText).toHaveBeenCalledWith('https://table.example/play/');
  });
});
