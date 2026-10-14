import { describe, expect, it, vi } from 'vitest';
import { copyJoinUrl, joinUrlsFromNotices, playerVisibleUrl } from './share-panel.js';

describe('player join links', () => {
  it('removes fragments before display or copy', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const reported = 'https://table.example/play/#private';
    expect(playerVisibleUrl(reported)).toBe('https://table.example/play/');
    await copyJoinUrl(reported, { writeText });
    expect(writeText).toHaveBeenCalledWith('https://table.example/play/');
  });

  it('accepts only fragment-free HTTP join URL notices', () => {
    expect(
      joinUrlsFromNotices([
        { level: 'info', code: 'join-url-lan', message: 'http://192.168.1.2:8787' },
        { level: 'info', code: 'join-url-public', message: 'https://table.example/play' },
        { level: 'info', code: 'join-url-public', message: 'https://table.example/play' },
        { level: 'info', code: 'join-url-public', message: 'javascript:alert(1)' },
        { level: 'info', code: 'join-url-public', message: 'https://table.example/#private' },
        { level: 'warning', code: 'other', message: 'https://ignored.example' },
      ]),
    ).toEqual([
      { kind: 'lan', url: 'http://192.168.1.2:8787' },
      { kind: 'public', url: 'https://table.example/play' },
    ]);
  });
});
