import { addAfterEffect, invalidate } from '@react-three/fiber';
import { fitThumbnail } from '../ui/campaign-thumbnail.js';

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/**
 * UX-05: one fresh frame of the board, scaled to a thumbnail and encoded as WebP. The canvas has
 * no `preserveDrawingBuffer`, so the pixels are copied in R3F's after-render effect, in the same
 * task as the render and before the browser presents (and clears) the buffer. A few frames pass
 * first so a projection the caller just switched to (`capturePublicBoard`) is what is drawn.
 */
export async function renderBoardThumbnail(
  canvas: HTMLCanvasElement,
  settleFrames = 3,
): Promise<Blob | null> {
  for (let i = 0; i < settleFrames; i++) {
    invalidate();
    await nextFrame();
  }
  const copy = await new Promise<HTMLCanvasElement | null>((resolve) => {
    let stop: () => void = () => undefined;
    const timer = window.setTimeout(() => {
      stop();
      resolve(null);
    }, 1000);
    stop = addAfterEffect(() => {
      window.clearTimeout(timer);
      stop();
      const size = fitThumbnail(canvas.width, canvas.height);
      const out = document.createElement('canvas');
      out.width = size.width;
      out.height = size.height;
      const context = out.getContext('2d');
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(canvas, 0, 0, size.width, size.height);
      resolve(out);
    });
    invalidate();
  });
  if (!copy) return null;
  return new Promise((resolve) => {
    copy.toBlob(resolve, 'image/webp', 0.8);
  });
}

/** The board's WebGL canvas, if the board is mounted. */
export function boardCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('.ui-board canvas');
}
