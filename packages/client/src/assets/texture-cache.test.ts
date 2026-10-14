import { describe, expect, it, vi } from 'vitest';
import { createTextureCache } from './texture-cache.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('texture cache', () => {
  it('loads each url once and returns stable entries', async () => {
    const load = vi.fn(() => Promise.resolve('tex'));
    const cache = createTextureCache(load);
    const first = cache.get('/assets/a');
    expect(first).toBe(cache.get('/assets/a'));
    expect(first.status).toBe('loading');
    await flush();
    const ready = cache.get('/assets/a');
    expect(ready).toEqual({ status: 'ready', texture: 'tex' });
    expect(ready).toBe(cache.get('/assets/a'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keys by url and notifies subscribers', async () => {
    const load = vi.fn((url: string) => Promise.resolve(url));
    const cache = createTextureCache(load);
    const seen = vi.fn();
    cache.subscribe(seen);
    cache.get('/assets/a');
    cache.get('/assets/b');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('records errors without retrying and disposes on clear', async () => {
    const cache = createTextureCache(() => Promise.reject(new Error('404')));
    cache.get('/assets/x');
    await flush();
    expect(cache.get('/assets/x')).toEqual({ status: 'error' });

    const dispose = vi.fn();
    const ok = createTextureCache(() => Promise.resolve('t'), dispose);
    ok.get('/assets/y');
    await flush();
    ok.clear();
    expect(dispose).toHaveBeenCalledWith('t');
  });
});
