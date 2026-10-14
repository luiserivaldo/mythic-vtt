import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { createTextureCache } from '../assets/texture-cache.js';

// Separate cache from TokenSprite's so map images (large) can be evicted independently later.
const loader = new TextureLoader();
const textures = createTextureCache<Texture>(
  (url) =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        reject,
      );
    }),
  (texture) => {
    texture.dispose();
  },
);

const NONE = { status: 'error' } as const;

export function useMapTexture(url: string | null) {
  const invalidate = useThree((state) => state.invalidate);
  const entry = useSyncExternalStore(
    (listener) => textures.subscribe(listener),
    () => (url ? textures.get(url) : NONE),
    () => NONE,
  );
  useEffect(() => {
    invalidate();
  }, [entry, invalidate]);
  return entry;
}

/** ENV-01: share the loaded texture dimensions between the image and its gizmo. */
export function mapTextureAspect(entry: ReturnType<typeof useMapTexture>): number {
  const image: unknown = entry.status === 'ready' ? entry.texture.image : null;
  if (typeof image !== 'object' || image === null || !('width' in image) || !('height' in image))
    return 1;
  const { width, height } = image;
  return typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? width / height
    : 1;
}

/**
 * ENV-05: a ready texture prepared for tiling. Cloned so each primitive owns its repeat and wrap;
 * the cache entry is shared with map images and must keep its own settings. Null while loading, on
 * error or without an image, so the caller falls back to the plain colour.
 */
export function useTiledTexture(
  url: string | null,
  repeatX: number,
  repeatY: number,
): Texture | null {
  const entry = useMapTexture(url);
  const tiled = useMemo(() => {
    if (entry.status !== 'ready') return null;
    const texture = entry.texture.clone();
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.needsUpdate = true;
    return texture;
  }, [entry, repeatX, repeatY]);
  useEffect(
    () => () => {
      tiled?.dispose();
    },
    [tiled],
  );
  return tiled;
}
