import { afterEach, describe, expect, it } from 'vitest';
import {
  BESIDE_GAP_PX,
  BESIDE_MARGIN_PX,
  besideTokenPlacement,
  selectionAnchorStore,
} from './beside-token.js';
import { toolPanels } from './registries.js';

const board = { width: 1000, height: 700 };
const panel = { width: 300, height: 200 };
const RAIL = 60;

describe('MV-239 / UI-TOKEN-02 panels beside the token', () => {
  afterEach(() => {
    selectionAnchorStore.setState({ anchor: null });
  });

  it('never registers a tool or token panel in the right dock', () => {
    for (const entry of toolPanels.all()) expect(entry.region).not.toBe('right-dock');
    for (const id of ['transform', 'aoe', 'token'])
      expect(toolPanels.get(id)?.region).toBe('beside-token');
  });

  it("opens on the token's left, vertically centred on it", () => {
    expect(besideTokenPlacement({ left: 600, right: 660, y: 350 }, panel, board, RAIL)).toEqual({
      left: 600 - BESIDE_GAP_PX - panel.width,
      top: 250,
    });
  });

  it('flips to the right side when the rail leaves no room on the left', () => {
    expect(besideTokenPlacement({ left: 200, right: 260, y: 350 }, panel, board, RAIL).left).toBe(
      260 + BESIDE_GAP_PX,
    );
  });

  it('stays inside the board and clear of the rail', () => {
    const top = besideTokenPlacement({ left: 200, right: 260, y: 10 }, panel, board, RAIL);
    expect(top.top).toBe(BESIDE_MARGIN_PX);
    const bottom = besideTokenPlacement({ left: 600, right: 660, y: 690 }, panel, board, RAIL);
    expect(bottom.top).toBe(board.height - BESIDE_MARGIN_PX - panel.height);
    // A token wider than the board leaves room on neither side: the panel keeps off the rail.
    expect(besideTokenPlacement({ left: 100, right: 990, y: 300 }, panel, board, RAIL).left).toBe(
      RAIL,
    );
  });

  it('sits beside the rail at the top of the board when the selection is not drawn', () => {
    expect(besideTokenPlacement(null, panel, board, RAIL)).toEqual({
      left: RAIL,
      top: BESIDE_MARGIN_PX,
    });
  });

  it('ignores sub-pixel anchor moves', () => {
    const setAnchor = (anchor: { left: number; right: number; y: number }) => {
      selectionAnchorStore.getState().setAnchor(anchor);
    };
    setAnchor({ left: 10, right: 20, y: 30 });
    const first = selectionAnchorStore.getState().anchor;
    setAnchor({ left: 10.2, right: 20.1, y: 30.3 });
    expect(selectionAnchorStore.getState().anchor).toBe(first);
    setAnchor({ left: 12, right: 22, y: 30 });
    expect(selectionAnchorStore.getState().anchor).not.toBe(first);
  });
});
