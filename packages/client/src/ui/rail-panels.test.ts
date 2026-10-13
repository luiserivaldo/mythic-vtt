// @vitest-environment happy-dom
import type { LayerId, Scene } from '@mythic/shared';
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

/** The Create prop form's layer picker, found by its own label. */
function layerSelect(): HTMLSelectElement {
  const label = [...container.querySelectorAll('label')].find((l) =>
    l.textContent.startsWith('Layer'),
  );
  const select = label?.querySelector('select');
  if (!select) throw new Error('no layer select in the Create prop form');
  return select;
}

function show(activeLayer: LayerId, isHost: boolean): void {
  const store = createUiStore();
  store.getState().setActiveLayer(activeLayer);
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

  it('starts its layer select on the viewer active layer (Layers tab)', () => {
    show('dm', true);
    expect(layerSelect().value).toBe('dm');
  });

  it('falls back to Props where the viewer may not create on the active layer', () => {
    show('dm', false);
    expect(layerSelect().value).toBe('props');
  });
});
