export type TextureEntry<T> =
  { status: 'loading' } | { status: 'ready'; texture: T } | { status: 'error' };

const LOADING: TextureEntry<never> = { status: 'loading' };
const ERROR: TextureEntry<never> = { status: 'error' };

/**
 * In-memory cache keyed by asset URL (which embeds the content hash, so equal keys are equal
 * bytes). Entries are stable objects until their status changes, so they are safe for
 * `useSyncExternalStore`. `load` is injected to keep this free of Three.js and the network.
 */
export function createTextureCache<T>(
  load: (url: string) => Promise<T>,
  dispose: (texture: T) => void = () => undefined,
) {
  const entries = new Map<string, TextureEntry<T>>();
  const listeners = new Set<() => void>();
  const notify = () => {
    listeners.forEach((l) => {
      l();
    });
  };

  return {
    get(url: string): TextureEntry<T> {
      const existing = entries.get(url);
      if (existing) return existing;
      entries.set(url, LOADING);
      load(url).then(
        (texture) => {
          entries.set(url, { status: 'ready', texture });
          notify();
        },
        () => {
          entries.set(url, ERROR);
          notify();
        },
      );
      return LOADING;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear(): void {
      for (const e of entries.values()) if (e.status === 'ready') dispose(e.texture);
      entries.clear();
    },
  };
}
