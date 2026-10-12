/**
 * UX-29 / UI-HELP-01: the static Help tab's content, as pure data.
 *
 * The Help tab replaces the on-screen mouse hint — the "status line" the shell must not have
 * (`UIUX.md` §1.2, UI-SHELL-01) — and it is the onboarding *instead of* first-time tooltips:
 * nothing here (or in `HelpPanel`) records a sign-in or a "seen" flag (UI-HELP-01).
 *
 * The camera and token rows are the input mapping UX-16 implements (`UIUX.md` §5.3,
 * UI-INPUT-01..04). It lives here once so the panel and the board cannot drift apart.
 */
export type HelpTopic = 'moving' | 'camera' | 'token';

export interface HelpEntry {
  /** The input, worded the way the interface names it. */
  input: string;
  /** What the input does, with the UI item it comes from for review traceability. */
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
      {
        input: 'Left press on a token',
        action:
          'Starts a move without selecting it first; the token becomes the selection too (UI-TOOL-01, Q23).',
      },
      {
        input: 'Left drag',
        action:
          'Moves the token you picked up. A left drag never moves the camera unless the Pan tool is active (UI-INPUT-01).',
      },
      {
        input: 'Measure tool — drag on the board',
        action:
          'Sizes the ruler or area of effect under the cursor with a live readout, so every shape is sized by dragging (UI-MEAS-02, UI-MEAS-04).',
      },
      {
        input: 'Any measurement',
        action: "Reads in the scene's units; the alpha shows feet only (UI-MEAS-03, GRID-02).",
      },
      {
        input: 'Right click with the Measure tool',
        action: 'Adds a waypoint to a 2D ruler; quick-deletes an AoE or the 3D ruler (UI-MEAS-05).',
      },
      {
        input: 'Left click while dragging a token',
        action:
          'With "Always measure token movement" on, drops a checkpoint and keeps measuring from it (UI-TOKEN-06, §10 C4).',
      },
    ],
  },
  camera: {
    id: 'camera',
    title: 'Camera controls',
    entries: [
      { input: 'Wheel', action: 'Zooms in and out (UI-INPUT-02, CAM-01).' },
      { input: 'Middle drag', action: 'Pans the view in both 2D and 3D (UI-INPUT-03, CAM-01).' },
      {
        input: 'Right drag in 3D',
        action:
          'Orbits around the focus point. In 2D the right button is kept for menus and waypoints, so a right drag does not move the camera (UI-INPUT-04, CAM-02).',
      },
      {
        input: 'Pan tool',
        action:
          'While it is active, a left drag pans the view instead of selecting, in 2D and 3D (UI-TOOL-02, UI-INPUT-01).',
      },
      {
        input: 'Reset view',
        action:
          'Returns the camera to its default framing; the button is shown in 3D (UI-TOP-05, CAM-01).',
      },
    ],
  },
  token: {
    id: 'token',
    title: 'Token interaction',
    entries: [
      {
        input: 'Middle click on the selected token',
        action:
          'Toggles its flying lock. A middle drag pans instead: the drag threshold separates the click from the drag (UI-INPUT-03, Q26).',
      },
      {
        input: 'Single click',
        action:
          'Opens a small preview card beside the token: its name and the quick fields (HP, AC, Speed). A value you may not see reads "not shared" (UI-TOKEN-01, PERM-03).',
      },
      {
        input: 'Double click, or the gear on the preview',
        action:
          'Opens the full token menu: name, image, height with the flying lock, layer and delete (UI-TOKEN-02).',
      },
      {
        input: 'Right click on a token',
        action:
          'Opens a short menu to its right: See Sheet, Add Condition, Change Layer and Token Options (UI-TOKEN-03).',
      },
    ],
  },
};

/** The sections in display order. The Help tab is static: this is the same for every viewer. */
export function helpSections(): readonly HelpSection[] {
  return HELP_TOPICS.map((topic) => HELP_SECTIONS[topic]);
}
