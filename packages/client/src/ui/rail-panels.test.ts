// @vitest-environment happy-dom
import type { Scene } from '@mythic/shared';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import { CreatePropPanel } from './RailPanels.js';
import { createUiStore, UiStoreContext } from './ui-store.js';

const S = tid(2);

const scene: Scene = {
  id: S,
  name: 'Cave',
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'alternating',
    snap: true,
  },
  environment: { background: '#000000' },
  layers: {},
  entities: {},
};

let container: HTMLDivElement;
let root: Root;

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const found = [...container.querySelectorAll('label')].find((l) =>
    l.textContent.trim().startsWith(label),
  );
  const control = found?.querySelector('input, select');
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement))
    throw new Error(`no ${label} field in the Create prop form`);
  return control;
}

function show(isHost: boolean): void {
  const store = createUiStore();
  // The Layers tab's active layer no longer steers the default (UI-TOOL-04, MV-246).
  store.getState().setActiveLayer('dm');
  act(() => {
    root.render(
      createElement(
        UiStoreContext.Provider,
        { value: store },
        createElement(CreatePropPanel, { scene, isHost }),
      ),
    );
  });
}

describe('Create Prop panel', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('offers every shape as an icon button, with no separate Create button (MV-266)', () => {
    show(true);
    const shapes = [...container.querySelectorAll('[role="group"][aria-label="Shape"] button')];
    expect(shapes.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Box',
      'Cylinder',
      'Cone',
      'Pyramid',
      'Sphere',
      'Plane',
      'Wedge',
    ]);
    expect(shapes.every((s) => s.querySelector('svg') !== null)).toBe(true);
    expect(container.querySelectorAll('button')).toHaveLength(shapes.length);
  });

  it('starts on the defaults: Prop 1, 1x1x1, grey, collidable, Props, no texture field', () => {
    show(true);
    expect(field('Prop name').value).toBe('Prop 1');
    for (const dim of ['Width', 'Height', 'Depth']) expect(field(dim).value).toBe('1');
    expect(field('Prop colour').value).toBe('#808080');
    expect((field('Collidable') as HTMLInputElement).checked).toBe(true);
    expect(field('Layer').value).toBe('props');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('defaults to Props for a co-DM too', () => {
    show(false);
    expect(field('Layer').value).toBe('props');
  });
});
