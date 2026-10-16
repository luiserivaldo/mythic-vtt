/**
 * UI-TOOL-01 / UI-INPUT-01 (MV-272): the rail tools that take an unclaimed left drag on empty
 * board for themselves. A tool that does not answer leaves it to the selection marquee, so Select,
 * Create Prop and Initiative all marquee without being listed anywhere. A tool can register a
 * claim that depends on its own state, for instance Create Prop while a ghost prop is being placed.
 */

/** Asked on each empty-board left press while its tool is active: true keeps the drag. */
export type EmptyBoardDragClaim = () => boolean;

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

/** Whether the active tool keeps an empty-board left drag. Default: no, so the marquee runs. */
export function toolClaimsEmptyBoardDrag(tool: string): boolean {
  return claims.get(tool)?.() ?? false;
}
