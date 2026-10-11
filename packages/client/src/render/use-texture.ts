import { useThree } from '@react-three/fiber';
import { useEffect, useSyncExternalStore } from 'react';
import { SRGBColorSpace, TextureLoader, type Texture } from 'three';
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
