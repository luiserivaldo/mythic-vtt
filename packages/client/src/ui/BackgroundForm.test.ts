// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef } from '@mythic/shared';
import type { IntentSpec } from './intent-specs.js';
import { BackgroundForm } from './BackgroundForm.js';

// ENV-07 / UI-SCN-01: the skybox image upload is out of the alpha (MV-247); a scene that already
// has one can still clear it. The dome that consumes it is covered by the e2e specs.

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
  });
}

describe('background form image skybox (ENV-07)', () => {
  it('has no skybox upload in the alpha (UI-SCN-01, MV-247)', async () => {
    await mount(form(vi.fn(() => Promise.resolve(true))));
    expect(container.querySelector('input[type="file"]')).toBeNull();
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
