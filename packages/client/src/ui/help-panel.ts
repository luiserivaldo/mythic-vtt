/**
 * UX-29 / UI-HELP-01: the static Help tab's content, as pure data.
 *
 * The Help tab replaces the on-screen mouse hint — the "status line" the shell must not have
 * (`UIUX.md` §1.2, UI-SHELL-01) — and it is the onboarding *instead of* first-time tooltips:
 * nothing here (or in `HelpPanel`) records a sign-in or a "seen" flag (UI-HELP-01).
 *
 * Only behaviour that is on the board today is listed; requirement IDs live in the comments above
 * each row and never in the copy.
 */
export type HelpTopic = 'moving' | 'camera' | 'token';

export interface HelpEntry {
  /** The input, worded the way the interface names it. */
  input: string;
  /** What the input does, in plain user-facing words. No requirement IDs here. */
  action: string;
}

export interface HelpSection {
  id: HelpTopic;
  title: string;
  entries: readonly HelpEntry[];
}

/** Display order: the issue lists moving and measuring first, then the camera, then tokens. */
export const HELP_TOPICS: readonly HelpTopic[] = ['moving', 'camera', 'token'];

/**
 * A record keyed by the topic union, not an array: TypeScript fails the build when a topic is
 * added and no section is written for it, so the list can never silently lose a topic.
 */
export const HELP_SECTIONS: Readonly<Record<HelpTopic, HelpSection>> = {
  moving: {
    id: 'moving',
    title: 'Moving and measuring',
    entries: [
      // UI-TOOL-01 / TOK-02 / Q23: the press claims the pointer and starts the move. M1-28 lets it
      // start on an unselected token; the click that a release without movement produces is what
      // selects, so the copy must not promise that the press selects.
      {
        input: 'Left press on a token',
        action: 'Picks it up straight away — there is no need to select it first.',
      },
      // UI-INPUT-01 / TOK-02: one move is sent on release.
      {
        input: 'Left drag on a token',
        action: 'Carries it to wherever you release the button.',
      },
      // UI-TOOL-03 / UI-MEAS-04 / Q28: every shape is sized by dragging, with a live readout.
      {
        input: 'Measure tool: drag on the board',
        action:
          'Sizes the ruler or area shape under the pointer as you drag, with the distance shown as you go.',
      },
      // UI-MEAS-05 / Q31: a measuring 2D ruler takes the waypoint, an AoE draft its own quick
      // delete, and anything else clears (rulerRightClick in tools/ruler.ts).
      {
        input: 'Measure tool: right click',
        action:
          'While a 2D ruler is in progress it adds a waypoint and measures on from it. Otherwise it clears the ruler, and on one of your own area shapes it deletes it.',
      },
      // UI-TOOL-03: Esc cancels the measurement, then puts the tool away.
      {
        input: 'Measure tool: Esc',
        action: 'Clears the measurement, and puts the tool away once nothing is being measured.',
      },
      // UI-MEAS-03 / GRID-02: feet only for the alpha, from the scene's own grid.
      {
        input: 'Any measurement',
        action: "Reads in the scene's units — feet in this alpha.",
      },
      // UI-MEAS-02: the Ruler panel's checkbox draws the drag's distance (TokenDrag renders
      // dragRulerPaths for the local drag and for every remote preview).
      {
        input: 'Always measure token movement',
        action:
          'Switched on in the Ruler panel, it draws the distance while a token is being dragged.',
      },
    ],
  },
  camera: {
    id: 'camera',
    title: 'Camera controls',
    entries: [
      // UI-INPUT-02 / CAM-01: a notched wheel zooms; touchpad scroll pans and a pinch zooms.
      {
        input: 'Wheel',
        action:
          'Zooms in and out. On a trackpad a two-finger scroll pans instead and a pinch zooms.',
      },
      // UI-INPUT-03 / CAM-01.
      { input: 'Middle drag', action: 'Pans the view, in both 2D and 3D.' },
      // UI-INPUT-01 / CAM-01: a press no token or handle claimed belongs to the camera.
      { input: 'Left drag on the empty board', action: 'Pans the view, in both 2D and 3D.' },
      // UI-INPUT-04 / CAM-02: right-drag orbits in 3D; in 2D the button stays free for the tool.
      {
        input: 'Right drag in 3D',
        action:
          'Orbits around the focus point. In 2D the right button belongs to the current tool, so it never moves the camera.',
      },
      // UI-TOP-05 / CAM-01: the button lives in the top bar and frames the scene again.
      {
        input: 'Reset view',
        action: 'In the top bar: frames the scene again, in both 2D and 3D.',
      },
    ],
  },
  token: {
    id: 'token',
    title: 'Token interaction',
    entries: [
      // UI-INPUT-01 / TOK-01 / UI-TOKEN-01: a plain click replaces the selection, a modifier toggles
      // membership. A single selection also shows its quick preview card beside the token, with the
      // name and the per-viewer quick values.
      {
        input: 'Left click on a token',
        action:
          "Selects it, and shows a small card beside it with the token's name and quick values. Shift, Ctrl or Cmd click adds it to the selection or takes it out.",
      },
      // UI-INPUT-03 / TOK-03 / Q26: the drag threshold separates the click from the pan.
      {
        input: 'Middle click on the selected token',
        action:
          'Toggles its flying lock, so it keeps its height. A middle drag pans instead: the drag threshold tells the two apart.',
      },
      // M1-20 (2D handles) / M1-47 (3D handle); a 3D token is raised and lowered.
      {
        input: 'Selected token',
        action:
          'In 2D its handles move, resize and rotate it; in 3D a handle raises and lowers it.',
      },
      // MEAS-05: the same ruler geometry, so the two readouts always agree.
      {
        input: 'Hover another token with one token selected',
        action: 'Shows the range between them: horizontal, vertical and total.',
      },
    ],
  },
};

/** The sections in display order. The Help tab is static: this is the same for every viewer. */
export function helpSections(): readonly HelpSection[] {
  return HELP_TOPICS.map((topic) => HELP_SECTIONS[topic]);
}
