/**
 * UI-TOOL-01 / UI-INPUT-01 (MV-272, MV-275): who takes an unclaimed left drag on empty board.
 * The marquee is opt-in: only the tools listed in `MARQUEE_THROUGH_TOOLS` leave the drag to the
 * selection marquee. Any other tool keeps it, so a new drag-based rail tool that forgets to say
 * anything never hands its drag to the marquee by accident. A tool can also register a claim that
 * depends on its own state, for instance Create Prop while a ghost prop is being placed; a
 * registered claim is asked first. Pan's left drag is the camera's (`emptyBoardLeftDrag`).
 */

/** Asked on each empty-board left press while its tool is active: true keeps the drag. */
export type EmptyBoardDragClaim = () => boolean;

/**
 * Rail tools that deliberately let an empty-board left drag draw the marquee. Every rail tool must
 * be Pan, claim the drag, or appear here (board-drag-claims.test.ts checks the rail registry).
 */
export const MARQUEE_THROUGH_TOOLS: ReadonlySet<string> = new Set([
  'select',
  'create-prop',
  'initiative',
]);

const claims = new Map<string, EmptyBoardDragClaim>([
  // The ruler and AoE templates start from a board drag (RulerTool, AoEPlacementCanvas).
  ['measure', () => true],
  // A freehand stroke starts from a board drag (DrawTool).
  ['draw', () => true],
]);

/**
 * Registers `tool`'s claim, replacing any earlier one, and returns a function that restores the
 * claim it replaced (or none).
 */
export function claimEmptyBoardDrag(tool: string, claim: EmptyBoardDragClaim): () => void {
  const previous = claims.get(tool);
  claims.set(tool, claim);
  return () => {
    if (claims.get(tool) !== claim) return;
    if (previous) claims.set(tool, previous);
    else claims.delete(tool);
  };
}

/** Whether `tool` has a claim registered (static or from `claimEmptyBoardDrag`). */
export function hasEmptyBoardDragClaim(tool: string): boolean {
  return claims.has(tool);
}

/**
 * Whether the active tool keeps an empty-board left drag: its registered claim decides; without
 * one, only a marquee-through tool lets the marquee run.
 */
export function toolClaimsEmptyBoardDrag(tool: string): boolean {
  const claim = claims.get(tool);
  if (claim) return claim();
  return !MARQUEE_THROUGH_TOOLS.has(tool);
}
