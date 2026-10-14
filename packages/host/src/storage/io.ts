import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export async function atomicWrite(
  path: string,
  data: string | Readable,
  validate?: () => void,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.tmp-${randomUUID()}`);
  try {
    if (typeof data === 'string') {
      const file = await open(temp, 'wx');
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
    } else {
      await pipeline(data, createWriteStream(temp, { flags: 'wx' }));
      const file = await open(temp, 'r');
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    }
    validate?.();
    await rename(temp, path);
    const directory = await open(dir, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
