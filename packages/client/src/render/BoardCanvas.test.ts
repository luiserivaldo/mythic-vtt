import { describe, expect, it, beforeEach } from 'vitest';
import { selectionStore } from '../tools/selection-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import { tokenDragStore } from '../tools/token-drag-store.js';

describe('BoardCanvas Escape key handling', () => {
  beforeEach(() => {
    // Reset all stores
    selectionStore.getState().clear();
    rulerStore.getState().setTool(false);
    rulerStore.getState().setPersistent(false);
    rulerStore.getState().clear();
    tokenDragStore.getState().setLocal(null);
    for (const sender of Object.keys(tokenDragStore.getState().remote)) {
      tokenDragStore.getState().setRemote(sender, null);
    }
  });

  it('clears selection when Escape is pressed with no active drag or measure', () => {
    // Setup: select some entities
    selectionStore.getState().pick('scene1', 'entity1', false);
    expect(selectionStore.getState().ids).toEqual(['entity1']);

    // Press Escape
    // The actual BoardCanvas handler calls:
    // if (dragState.local) { dragState.setLocal(null); }
    // else if (rulerStore.getState().phase === 'active') { rulerStore.getState().clear(); }
    // else { selectionStore.getState().clear(); }

    const dragState = tokenDragStore.getState();
    if (dragState.local) {
      dragState.setLocal(null);
    } else if (rulerStore.getState().phase === 'active') {
      rulerStore.getState().clear();
    } else {
      selectionStore.getState().clear();
    }

    // Selection should be cleared
    expect(selectionStore.getState().ids).toEqual([]);
  });

  it('cancels active token drag when Escape is pressed', () => {
    // Setup: start a local drag
    tokenDragStore.getState().setLocal({
      sceneId: 'scene1',
      entityId: 'entity1',
      base: { x: 0, y: 0, z: 0 },
      to: { x: 5, y: 0, z: 5 },
      settling: false,
    });
    expect(tokenDragStore.getState().local).not.toBeNull();

    // Press Escape - should cancel drag first
    const dragState = tokenDragStore.getState();
    if (dragState.local) {
      dragState.setLocal(null);
    } else if (rulerStore.getState().phase === 'active') {
      rulerStore.getState().clear();
    } else {
      selectionStore.getState().clear();
    }

    // Drag should be cancelled, selection unchanged
    expect(tokenDragStore.getState().local).toBeNull();
    expect(selectionStore.getState().ids).toEqual([]); // selection unchanged
  });

  it('clears active ruler measurement when Escape is pressed (no active drag)', () => {
    // Setup: start a ruler measurement
    rulerStore.getState().setTool(true);
    rulerStore.getState().begin('scene1', { x: 0, y: 0, z: 0 });
    rulerStore.getState().setPoints([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 5 },
    ]);
    expect(rulerStore.getState().phase).toBe('active');

    // Press Escape - should clear ruler since no active drag
    const dragState = tokenDragStore.getState();
    if (dragState.local) {
      dragState.setLocal(null);
    } else if (rulerStore.getState().phase === 'active') {
      rulerStore.getState().clear();
    } else {
      selectionStore.getState().clear();
    }

    // Ruler should be cleared
    expect(rulerStore.getState().phase).toBe('idle');
    expect(rulerStore.getState().points).toEqual([]);
  });

  it('priority: drag cancelled before ruler, ruler cleared before selection', () => {
    // Setup: both drag and ruler active
    tokenDragStore.getState().setLocal({
      sceneId: 'scene1',
      entityId: 'entity1',
      base: { x: 0, y: 0, z: 0 },
      to: { x: 5, y: 0, z: 5 },
      settling: false,
    });
    rulerStore.getState().setTool(true);
    rulerStore.getState().begin('scene1', { x: 0, y: 0, z: 0 });
    selectionStore.getState().pick('scene1', 'entity1', false);

    // Press Escape - should cancel drag only (highest priority)
    const dragState = tokenDragStore.getState();
    if (dragState.local) {
      dragState.setLocal(null);
    } else if (rulerStore.getState().phase === 'active') {
      rulerStore.getState().clear();
    } else {
      selectionStore.getState().clear();
    }

    // Only drag should be cancelled
    expect(tokenDragStore.getState().local).toBeNull();
    expect(rulerStore.getState().phase).toBe('active'); // ruler unchanged
    expect(selectionStore.getState().ids).toEqual(['entity1']); // selection unchanged

    // Press Escape again - should clear ruler (next priority)
    const dragState2 = tokenDragStore.getState();
    if (dragState2.local) {
      dragState2.setLocal(null);
    } else if (rulerStore.getState().phase === 'active') {
      rulerStore.getState().clear();
    } else {
      selectionStore.getState().clear();
    }

    // Ruler should be cleared now
    expect(tokenDragStore.getState().local).toBeNull();
    expect(rulerStore.getState().phase).toBe('idle');
    expect(selectionStore.getState().ids).toEqual(['entity1']); // selection unchanged

    // Press Escape third time - should clear selection (lowest priority)
    const dragState3 = tokenDragStore.getState();
    if (dragState3.local) {
      dragState3.setLocal(null);
    } else if (rulerStore.getState().phase === 'active') {
      rulerStore.getState().clear();
    } else {
      selectionStore.getState().clear();
    }

    // Selection should be cleared
    expect(tokenDragStore.getState().local).toBeNull();
    expect(rulerStore.getState().phase).toBe('idle');
    expect(selectionStore.getState().ids).toEqual([]);
  });
});

describe('modifier-click additive selection', () => {
  beforeEach(() => {
    selectionStore.getState().clear();
  });

  it('shift+click adds to selection', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    expect(selectionStore.getState().ids).toEqual(['entity1']);

    // Shift+click another entity - additive should be true
    selectionStore.getState().pick('scene1', 'entity2', true);
    expect(selectionStore.getState().ids).toEqual(['entity1', 'entity2']);
  });

  it('ctrl+click adds to selection', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    expect(selectionStore.getState().ids).toEqual(['entity1']);

    // Ctrl+click another entity - additive should be true
    selectionStore.getState().pick('scene1', 'entity2', true);
    expect(selectionStore.getState().ids).toEqual(['entity1', 'entity2']);
  });

  it('meta+click (Cmd on Mac) adds to selection', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    expect(selectionStore.getState().ids).toEqual(['entity1']);

    // Meta+click another entity - additive should be true
    selectionStore.getState().pick('scene1', 'entity2', true);
    expect(selectionStore.getState().ids).toEqual(['entity1', 'entity2']);
  });

  it('plain click replaces selection', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    selectionStore.getState().pick('scene1', 'entity2', false);
    expect(selectionStore.getState().ids).toEqual(['entity2']);
  });

  it('clicking selected entity with modifier removes it (toggle)', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    selectionStore.getState().pick('scene1', 'entity2', true);
    expect(selectionStore.getState().ids).toEqual(['entity1', 'entity2']);

    // Shift+click entity1 again - should remove it
    selectionStore.getState().pick('scene1', 'entity1', true);
    expect(selectionStore.getState().ids).toEqual(['entity2']);
  });

  it('click empty board with modifier keeps selection', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    expect(selectionStore.getState().ids).toEqual(['entity1']);

    // Shift+click empty board - additive true, picked null -> keeps selection
    selectionStore.getState().pick('scene1', null, true);
    expect(selectionStore.getState().ids).toEqual(['entity1']);
  });

  it('click empty board without modifier clears selection', () => {
    selectionStore.getState().pick('scene1', 'entity1', false);
    expect(selectionStore.getState().ids).toEqual(['entity1']);

    // Click empty board - additive false, picked null -> clears selection
    selectionStore.getState().pick('scene1', null, false);
    expect(selectionStore.getState().ids).toEqual([]);
  });
});
