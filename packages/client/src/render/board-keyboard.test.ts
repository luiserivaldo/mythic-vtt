// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rulerStore } from '../tools/ruler-store.js';
import { selectionStore } from '../tools/selection-store.js';
import { tokenDragStore } from '../tools/token-drag-store.js';
import { pointerClaims } from './pointer-claims.js';
import { BoardCanvas } from './BoardCanvas.js';

// The WebGL canvas and dock are irrelevant here; render the actual board's DOM key handler.
vi.mock('@react-three/fiber', () => ({ Canvas: () => null }));
vi.mock('../ui/ToolPanelDock.js', () => ({ ToolPanelDock: () => null }));
vi.mock('../store/react.js', () => ({ useClientStore: () => null }));

let container: HTMLDivElement;
let root: Root;
let board: HTMLElement;

function escape(target: HTMLElement = board): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

describe('BoardCanvas Escape handler', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(BoardCanvas));
    });
    board = container.querySelector('[aria-label="Scene board"]') as HTMLElement;
    selectionStore.getState().pick('scene', 'token', false);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    selectionStore.getState().clear();
    tokenDragStore.getState().setLocal(null);
    rulerStore.getState().clear();
    rulerStore.getState().setTool(false);
    pointerClaims.release(1);
  });

  it('removes redundant buttons and clears selection on Escape', () => {
    expect(board.textContent).not.toContain('Multi-select');
    expect(board.textContent).not.toContain('Clear selection');
    escape();
    expect(selectionStore.getState().ids).toEqual([]);
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('leaves selection in %s alone', (tagName) => {
    const editor = document.createElement(tagName);
    board.append(editor);
    escape(editor);
    expect(selectionStore.getState().ids).toEqual(['token']);
  });

  it('leaves selection in contenteditable alone', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    board.append(editor);
    escape(editor);
    expect(selectionStore.getState().ids).toEqual(['token']);
  });

  it('lets the token drag listener cancel before a second Escape clears selection', () => {
    pointerClaims.claim(1, 'token drag');
    escape();
    expect(selectionStore.getState().ids).toEqual(['token']);
    pointerClaims.release(1);
    escape();
    expect(selectionStore.getState().ids).toEqual([]);
  });

  it.each(['active', 'finished'] as const)(
    'leaves a %s ruler for its window listener to cancel and broadcast',
    (phase) => {
      act(() => {
        rulerStore.getState().setTool(true);
        rulerStore.getState().begin('scene', { x: 0, y: 0, z: 0 });
        if (phase === 'finished') rulerStore.getState().finish();
      });
      escape();
      expect(selectionStore.getState().ids).toEqual(['token']);
      expect(rulerStore.getState().phase).toBe(phase);
      rulerStore.getState().clear(); // RulerTool's later window listener.
      escape();
      expect(selectionStore.getState().ids).toEqual([]);
    },
  );

  it.each(['2D gizmo', '3D gizmo'])('leaves a %s drag for its window listener', (owner) => {
    pointerClaims.claim(1, owner);
    escape();
    expect(selectionStore.getState().ids).toEqual(['token']);
    pointerClaims.release(1);
    escape();
    expect(selectionStore.getState().ids).toEqual([]);
  });

  it('leaves a settling token in place but clears selection', () => {
    tokenDragStore.getState().setLocal({
      sceneId: 'scene',
      entityId: 'token',
      base: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 0 },
      settling: true,
    });
    escape();
    expect(selectionStore.getState().ids).toEqual([]);
    expect(tokenDragStore.getState().local?.settling).toBe(true);
  });
});
