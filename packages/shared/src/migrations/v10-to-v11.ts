import type { MigrationStep } from './runner.js';

/**
 * UX-46 (MV-251, save v11): the 0.0.1 per-scene "players may measure / draw / place pins" toggles
 * (`Scene.playerToggles`) become per-seat `Seat.tools`. There is no table-wide or scene-wide
 * switch any more, so each seat gets the value it effectively had.
 *
 * A seat cannot carry a value per scene. When every scene a player could be in agrees, the seat
 * keeps exactly what it had. When they disagree, the seat gets the stricter value (a tool on in
 * only some scenes becomes off), so a migration never grants a player something the DM had
 * withheld anywhere. DM-only scenes are ignored because players never act in them, unless every
 * scene is DM-only.
 *
 * Seats live in `campaign.json` and toggles in each scene file, so a single-file step cannot see
 * both: the store folds them with `foldLegacyPlayerToggles` when it loads (or imports) a pre-v11
 * campaign together with its raw scene files. A snapshot holds the whole campaign and is folded
 * here. Everything is a pure copy: inputs are never mutated.
 */

/** Saves older than this keep player permissions in scene files and need the store's fold. */
export const SEAT_TOOLS_SINCE_VERSION = 11;

/** The 0.0.1 defaults for a scene without toggles, frozen here so later changes cannot move them. */
const LEGACY_DEFAULTS = { measure: true, draw: false, pins: false } as const;
type LegacyTool = keyof typeof LEGACY_DEFAULTS;
const TOOLS: readonly LegacyTool[] = ['measure', 'draw', 'pins'];

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function sceneToggle(scene: Record<string, unknown>, tool: LegacyTool): boolean {
  const toggles = scene['playerToggles'];
  const value = record(toggles) ? toggles[tool] : undefined;
  return typeof value === 'boolean' ? value : LEGACY_DEFAULTS[tool];
}

/** The per-seat tools that reproduce a pre-v11 campaign's scene toggles (see the file comment). */
export function legacySeatTools(scenes: readonly unknown[]): Record<LegacyTool, boolean> {
  const all = scenes.filter(record);
  const playable = all.filter((scene) => scene['dmOnly'] !== true);
  const pool = playable.length > 0 ? playable : all;
  const tools = { ...LEGACY_DEFAULTS } as Record<LegacyTool, boolean>;
  if (pool.length === 0) return tools;
  for (const tool of TOOLS) tools[tool] = pool.every((scene) => sceneToggle(scene, tool));
  return tools;
}

/**
 * Gives every seat that has no `tools` yet the tools its scenes used to grant. Every seat gets
 * them, co-DMs and archived seats too: a co-DM ignores them, but if it is later made a player it
 * is limited exactly as the scene toggles limited it in 0.0.1. Seats that already have `tools`
 * are left alone, so folding twice is harmless.
 */
export function foldLegacyPlayerToggles<T>(campaign: T, scenes: readonly unknown[]): T {
  if (!record(campaign) || !record(campaign['seats'])) return campaign;
  const tools = legacySeatTools(scenes);
  const seats = Object.fromEntries(
    Object.entries(campaign['seats']).map(([id, seat]) => [
      id,
      record(seat) && !record(seat['tools']) ? { ...seat, tools: { ...tools } } : seat,
    ]),
  );
  return { ...campaign, seats };
}

/** A scene payload without the removed `playerToggles` field. */
export function withoutPlayerToggles(scene: unknown): unknown {
  if (!record(scene) || !('playerToggles' in scene)) return scene;
  const copy = { ...scene };
  delete copy['playerToggles'];
  return copy;
}

function migrateState(state: unknown): unknown {
  if (!record(state)) return state;
  const scenes = record(state['scenes']) ? state['scenes'] : {};
  const folded = foldLegacyPlayerToggles(state, Object.values(scenes));
  if (!record(state['scenes'])) return folded;
  return {
    ...folded,
    scenes: Object.fromEntries(
      Object.entries(scenes).map(([id, scene]) => [id, withoutPlayerToggles(scene)]),
    ),
  };
}

export const v10ToV11: MigrationStep = {
  from: 10,
  migrate(payload, kind) {
    // A snapshot carries seats and scenes together, so it folds the toggles itself.
    if (kind === 'snapshot') {
      if (!record(payload) || !('state' in payload)) return payload;
      const state = migrateState(payload['state']);
      return { ...payload, state: record(state) ? { ...state, schemaVersion: 11 } : state };
    }
    // A campaign file on its own has no scenes; the store folds it (foldLegacyPlayerToggles)
    // with the raw scene files it loads next to it. A scene file keeps its toggles here so that
    // fold can still read them; the v11 Scene schema drops the field once it has been folded.
    return payload;
  },
};
