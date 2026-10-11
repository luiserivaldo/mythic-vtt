import { expect, it } from 'vitest';
import fc from 'fast-check';
import { Entity, Scene } from '@mythic/shared';
import { makeCampaign, tid } from '../testing.js';
import { activeRenderScene } from './scene-model.js';

it('maps persistent ring radii from scene units to cells and follows token elevation', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 1, max: 100 }),
      (radius, unitsPerCell) => {
        const token = Entity.parse({
          id: tid(3),
          layer: 'tokens',
          name: 'Ring token',
          owners: [],
          transform: {
            position: { x: 3, y: 4, z: 4 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: {
            sizeCells: 1,
            heightCells: 1,
            labelVisibility: 'all',
            rings: [{ radius, color: '#55aaff' }],
          },
        });
        const board = Scene.parse({
          id: tid(2),
          name: 'Scene',
          grid: {
            type: 'square',
            sizePx: 70,
            unitsPerCell,
            unitLabel: 'ft',
            diagonal: 'chebyshev',
            snap: true,
          },
          environment: { background: '#112233' },
          layers: {},
          entities: { [token.id]: token },
        });
        const state = makeCampaign();
        state.scenes[board.id] = board;
        state.activeSceneId = board.id;
        const shown = activeRenderScene(state)?.entities.find((item) => item.id === token.id);
        expect(shown?.rings?.[0]?.radius).toBeCloseTo(radius / unitsPerCell);
        expect(shown?.position[1]).toBe(4);
      },
    ),
  );
});
