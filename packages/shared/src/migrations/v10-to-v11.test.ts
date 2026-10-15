import { describe, expect, it } from 'vitest';
import { canUseTool } from '../actions/seat-tools.js';
import { ACTORS, IDS, makeCampaign, testId } from '../actions/testing.js';
import { Campaign } from '../schema/index.js';
import { createStoreMigrate } from './registry.js';
import { foldLegacyPlayerToggles, legacySeatTools } from './v10-to-v11.js';

const migrate = createStoreMigrate(undefined, 11);
const TOOLS = ['measure', 'draw', 'pins'] as const;

/** The 0.0.1 rule (PERM-05 + scene defaults), reimplemented here as the oracle. */
function legacyAllows(
  toggles: Partial<Record<(typeof TOOLS)[number], boolean>> | undefined,
  tool: (typeof TOOLS)[number],
): boolean {
  return toggles?.[tool] ?? tool === 'measure';
}

/** A v10 campaign: one scene with 0.0.1 toggles, as the 0.0.1 Settings and Scenes tab wrote. */
function v10Campaign(toggles?: Record<string, boolean>) {
  const state = { ...makeCampaign(), schemaVersion: 10 };
  const scene = state.scenes[IDS.scene] as Record<string, unknown> | undefined;
  if (!scene) throw new Error('scene');
  if (toggles) scene['playerToggles'] = toggles;
  return state;
}

describe('v10 to v11: scene toggles become per-seat tools', () => {
  it.each([
    [undefined],
    [{ measure: false }],
    [{ draw: true }],
    [{ pins: true, measure: true }],
    [{ draw: true, measure: false, pins: true }],
  ])('a single-scene 0.0.1 snapshot keeps every seat effective permission (%j)', (toggles) => {
    const state = v10Campaign(toggles);
    const before = structuredClone(state);
    const out = migrate('snapshot', 10, { schemaVersion: 10, state, seq: 3 }) as {
      state: unknown;
      seq: number;
    };
    expect(state).toEqual(before);
    expect(out.seq).toBe(3);
    const campaign = Campaign.parse(out.state);
    expect(campaign.schemaVersion).toBe(11);
    expect(JSON.stringify(campaign)).not.toContain('playerToggles');
    for (const tool of TOOLS) {
      expect(canUseTool(campaign, ACTORS.owner, IDS.scene, tool)).toBe(legacyAllows(toggles, tool));
      expect(canUseTool(campaign, ACTORS.otherSeat, IDS.scene, tool)).toBe(
        legacyAllows(toggles, tool),
      );
      // The host and co-DMs were never limited and still are not.
      expect(canUseTool(campaign, ACTORS.host, IDS.scene, tool)).toBe(true);
      expect(canUseTool(campaign, ACTORS.coDm, IDS.scene, tool)).toBe(true);
    }
  });

  it('folds a campaign file with its raw scene files, keeping all other seat data', () => {
    const state = v10Campaign();
    const campaignFile = migrate('campaign', 10, { ...state, scenes: undefined });
    const scene = { name: 'Nave', playerToggles: { draw: true, measure: false } };
    // The scene step keeps the field for the fold; the v11 Scene schema drops it afterwards.
    expect(migrate('scene', 10, scene)).toBe(scene);
    const folded = foldLegacyPlayerToggles(campaignFile, [scene]) as Record<string, unknown>;
    const seats = folded['seats'] as Record<string, Record<string, unknown>>;
    for (const seat of Object.values(seats)) {
      expect(seat['tools']).toEqual({ measure: false, draw: true, pins: false });
    }
    const original = state.seats[IDS.owner];
    expect(seats[IDS.owner]).toEqual({ ...original, tools: seats[IDS.owner]?.['tools'] });
  });

  it('uses the stricter value when player scenes disagree and ignores DM-only scenes', () => {
    expect(
      legacySeatTools([
        { playerToggles: { draw: true, pins: true } },
        { playerToggles: { draw: false, pins: true } },
        { dmOnly: true, playerToggles: { pins: false, measure: false } },
      ]),
    ).toEqual({ measure: true, draw: false, pins: true });
    // Every scene DM-only: they are all that is known, so they still count.
    expect(legacySeatTools([{ dmOnly: true, playerToggles: { measure: false } }])).toEqual({
      measure: false,
      draw: false,
      pins: false,
    });
    expect(legacySeatTools([])).toEqual({ measure: true, draw: false, pins: false });
  });

  it('never overwrites tools a seat already has, so folding twice is harmless', () => {
    const id = testId(40);
    const campaign = {
      seats: { [id]: { id, tools: { measure: false, draw: true, pins: true } } },
    };
    const folded = foldLegacyPlayerToggles(campaign, [{ playerToggles: { measure: true } }]);
    expect(folded).toEqual(campaign);
    expect(foldLegacyPlayerToggles(folded, [])).toEqual(campaign);
  });

  it('passes malformed payloads through untouched', () => {
    expect(foldLegacyPlayerToggles(null, [])).toBeNull();
    expect(foldLegacyPlayerToggles({ seats: 3 }, [])).toEqual({ seats: 3 });
    expect(migrate('snapshot', 10, { schemaVersion: 10, seq: 1 })).toEqual({
      schemaVersion: 11,
      seq: 1,
    });
  });
});
