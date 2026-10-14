import { describe, expect, it } from 'vitest';
import { RENDER_BUDGET, withinRenderBudget } from './performance-budget.js';

describe('renderer budget', () => {
  it('accepts the boundary', () => {
    expect(
      withinRenderBudget({
        triangles: RENDER_BUDGET.triangles,
        calls: RENDER_BUDGET.drawCalls,
      }),
    ).toBe(true);
  });

  it.each([
    { triangles: RENDER_BUDGET.triangles + 1, calls: 1 },
    { triangles: 1, calls: RENDER_BUDGET.drawCalls + 1 },
  ])('rejects an exceeded metric: %o', (info) => {
    expect(withinRenderBudget(info)).toBe(false);
  });
});
