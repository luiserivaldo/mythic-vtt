export const PERFORMANCE_SCENE = {
  tokens: 100,
  props: 100,
  aoes: 25,
} as const;

export const RENDER_BUDGET = {
  triangles: 300_000,
  drawCalls: 1_000,
} as const;

export interface RenderInfo {
  calls: number;
  triangles: number;
}

export function withinRenderBudget(info: RenderInfo): boolean {
  return info.triangles <= RENDER_BUDGET.triangles && info.calls <= RENDER_BUDGET.drawCalls;
}
