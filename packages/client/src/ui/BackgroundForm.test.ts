// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef } from '@mythic/shared';
import type { IntentSpec } from './intent-specs.js';
import { BackgroundForm } from './BackgroundForm.js';

// ENV-07: the form's only job for the image skybox is to turn a chosen file into a `scene.update`
// intent through the injectable uploader; the dome that consumes it is covered by the e2e specs.

const HASH = 'a'.repeat(64);
let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

async function mount(ui: ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
    await Promise.resolve();
  });
}

function form(send: (intent: IntentSpec) => Promise<boolean>, skybox?: AssetRef): ReactElement {
  return createElement(BackgroundForm, {
    sceneId: 's1',
    initial: { background: '#000000', zenith: '' },
    ...(skybox ? { skybox } : {}),
    send,
    uploader: () => Promise.resolve({ hash: HASH, width: 1, height: 1 }),
  });
}

async function chooseFile(name: string): Promise<void> {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([new Uint8Array([1])], name, { type: 'image/png' })],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('background form image skybox (ENV-07)', () => {
  it('uploads a chosen image and sets it as the scene skybox', async () => {
    const send = vi.fn(() => Promise.resolve(true));
    await mount(form(send));
    await chooseFile('sky.png');
    expect(send).toHaveBeenCalledWith({
      type: 'scene.update',
      payload: {
        sceneId: 's1',
        skybox: { source: 'local', hash: HASH, kind: 'image', name: 'sky.png' },
      },
      sceneId: 's1',
    });
  });

  it('offers a clear control only while an image is set', async () => {
    const send = vi.fn(() => Promise.resolve(true));
    await mount(form(send));
    expect(container.textContent).not.toContain('Clear skybox');

    await act(async () => {
      root.render(form(send, { source: 'local', hash: HASH, kind: 'image' }));
      await Promise.resolve();
    });
    const clear = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear skybox',
    );
    expect(clear).toBeDefined();
    await act(async () => {
      clear?.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith({
      type: 'scene.update',
      payload: { sceneId: 's1', skybox: null },
      sceneId: 's1',
    });
  });
});
