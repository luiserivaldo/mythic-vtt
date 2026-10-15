import { describe, expect, it } from 'vitest';
import { propCollidableIntent } from './prop-menu.js';

describe('propCollidableIntent', () => {
  it('replaces the shape with walkable changed through entity.update', () => {
    const shape = { kind: 'box' as const, color: '#fff', walkable: true, showGridOnTop: true };
    expect(propCollidableIntent('s1', 'e1', shape, false)).toEqual({
      type: 'entity.update',
      payload: { sceneId: 's1', entityId: 'e1', changes: { shape: { ...shape, walkable: false } } },
      sceneId: 's1',
    });
  });
});
