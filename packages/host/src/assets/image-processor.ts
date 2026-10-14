import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import type { AssetStore } from '../storage/index.js';

const ACCEPTED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const THUMBNAIL_SIZE = 320;

export class InvalidImageError extends Error {}

export interface StoredImage {
  hash: string;
  mime: 'image/webp';
  size: number;
  width: number;
  height: number;
}

export interface ProcessedImage {
  image: StoredImage;
  thumbnail: StoredImage;
  deduplicated: boolean;
}

interface EncodedImage {
  data: Buffer;
  width: number;
  height: number;
}

async function encodeWebp(input: Buffer, thumbnail: boolean): Promise<EncodedImage> {
  let pipeline = sharp(input, {
    animated: false,
    failOn: 'warning',
    limitInputPixels: MAX_IMAGE_PIXELS,
  }).rotate();
  if (thumbnail) {
    pipeline = pipeline.resize({
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const { data, info } = await pipeline
    .webp({ quality: thumbnail ? 75 : 85, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function storeEncoded(
  store: AssetStore,
  encoded: EncodedImage,
): Promise<{ asset: StoredImage; existed: boolean }> {
  const hash = createHash('sha256').update(encoded.data).digest('hex');
  const existed = await store.has(hash);
  if (!existed) {
    await store.put(hash, Readable.from([encoded.data]), {
      mime: 'image/webp',
      size: encoded.data.byteLength,
      ext: 'webp',
    });
  }
  return {
    asset: {
      hash,
      mime: 'image/webp',
      size: encoded.data.byteLength,
      width: encoded.width,
      height: encoded.height,
    },
    existed,
  };
}

/** Validates decoded image metadata before producing content-addressed WebP derivatives. */
export async function processImage(input: Buffer, store: AssetStore): Promise<ProcessedImage> {
  let image: EncodedImage;
  let thumbnail: EncodedImage;
  try {
    const metadata = await sharp(input, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
    if (!ACCEPTED_IMAGE_FORMATS.has(metadata.format)) {
      throw new InvalidImageError('Only JPEG, PNG, and WebP images are accepted');
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new InvalidImageError('Animated or multi-page images are not accepted');
    }
    if (!metadata.width || !metadata.height) {
      throw new InvalidImageError('Image dimensions are missing');
    }

    [image, thumbnail] = await Promise.all([encodeWebp(input, false), encodeWebp(input, true)]);
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError('The upload is not a valid supported image');
  }
  const [storedImage, storedThumbnail] = await Promise.all([
    storeEncoded(store, image),
    storeEncoded(store, thumbnail),
  ]);
  return {
    image: storedImage.asset,
    thumbnail: storedThumbnail.asset,
    deduplicated: storedImage.existed && storedThumbnail.existed,
  };
}
