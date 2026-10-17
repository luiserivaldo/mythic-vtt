import { describe, expect, it } from 'vitest';
import {
  Campaign,
  DEFAULT_SEAT_TOOLS,
  PLAYER_TEMPLATE_TOOLS,
  reduceAction,
  resolveSeatTools,
  SEAT_TEMPLATES,
  seatTemplate,
  type ActionEnvelope,
  type SeatTools,
} from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';
import { canPerform } from './run.js';
import { canUseTool, PING_CHANNEL, PING_TOOL, TOOL_FOR_CHANNEL } from './seat-tools.js';
import { sceneSetPlayerToggles } from './scene.setPlayerToggles.js';
import { seatCreate } from './seat.create.js';
import { seatUpdate } from './seat.update.js';
import { DRAW_CLEAR_CHANNEL, DRAW_ERASE_CHANNEL, DRAW_STROKE_CHANNEL } from '../drawing.js';

const envelope = (type: string, payload: unknown, seq = 1): ActionEnvelope => ({
  id: IDS.action,
  type,
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq,
  ts: 1000,
});

function withTools(seatId: string, tools: SeatTools) {
  const state = makeCampaign();
  const seat = state.seats[seatId];
  if (!seat) throw new Error('seat');
  seat.tools = tools;
  return state;
}

const NONE: SeatTools = { measure: false, draw: false, pins: false };
const ALL: SeatTools = { measure: true, draw: true, pins: true };

describe('permission templates (UX-46, UI-SEAT-02)', () => {
  it('each template carries default tools; Player may measure, draw and ping (MV-288)', () => {
    // MV-303 Q1 / MV-310 Q4: no template grants Interact; the DM grants it per seat.
    expect(seatTemplate('player').tools).toEqual({
      measure: true,
      draw: true,
      pins: true,
      interact: false,
    });
    expect(seatTemplate('player').tools).toEqual(PLAYER_TEMPLATE_TOOLS);
    expect(seatTemplate('spectator').tools).toEqual({ ...NONE, interact: false });
    expect(seatTemplate('dm').tools).toEqual({ ...ALL, interact: false });
    expect(seatTemplate('codm').tools).toEqual({ ...ALL, interact: false });
    // Templates are copied, never shared: no template object is a default object.
    for (const template of SEAT_TEMPLATES) {
      expect(template.tools).not.toBe(DEFAULT_SEAT_TOOLS);
      expect(template.tools).not.toBe(PLAYER_TEMPLATE_TOOLS);
    }
  });

  it('keeps the tool-less fallback frozen at the 0.0.1 scene defaults', () => {
    expect(DEFAULT_SEAT_TOOLS).toEqual({
      measure: true,
      draw: false,
      pins: false,
      interact: false,
    });
  });

  it('a seat without stored tools gets the frozen fallback, not the Player template', () => {
    const state = makeCampaign();
    const owner = state.seats[IDS.owner];
    if (!owner) throw new Error('seat');
    expect(owner.tools).toBeUndefined();
    expect(resolveSeatTools(owner)).toEqual(DEFAULT_SEAT_TOOLS);
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'measure')).toBe(true);
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'pins')).toBe(false);
  });

  it('seat.create starts a seat from its template tools', () => {
    const tools = seatTemplate('spectator').tools;
    const payload = { seatId: IDS.otherIdentity, label: 'Watcher', tools };
    expect(seatCreate.schema.safeParse(payload).success).toBe(true);
    expect(seatCreate.schema.safeParse({ ...payload, tools: { measure: true } }).success).toBe(
      false,
    );
    const { state } = reduceAction(makeCampaign(), envelope('seat.create', payload));
    expect(state.seats[IDS.otherIdentity]?.tools).toEqual({ ...NONE, interact: false });
    expect(state.seats[IDS.otherIdentity]?.tools).not.toBe(tools);
  });
});

describe('per-seat override (UX-46)', () => {
  it('seat.update overrides one tool on one seat and leaves every other seat alone', () => {
    const before = makeCampaign();
    const payload = { seatId: IDS.owner, tools: { draw: true } };
    const { state } = reduceAction(before, envelope('seat.update', payload));
    expect(state.seats[IDS.owner]?.tools).toEqual({
      measure: true,
      draw: true,
      pins: false,
      interact: false,
    });
    expect(state.seats[IDS.other]?.tools).toBeUndefined();
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'draw')).toBe(true);
    expect(canUseTool(state, ACTORS.otherSeat, IDS.scene, 'draw')).toBe(false);
    expect(before.seats[IDS.owner]?.tools).toBeUndefined();
    const parsed = Campaign.parse(JSON.parse(JSON.stringify(state)));
    expect(parsed.seats[IDS.owner]?.tools).toEqual({
      measure: true,
      draw: true,
      pins: false,
      interact: false,
    });
  });

  it('only the host may override, and the payload is strict and non-empty', () => {
    const payload = { seatId: IDS.owner, tools: { measure: false } };
    expect(permissionMatrix(makeCampaign(), 'seat.update', payload)).toEqual({
      host: true,
      coDm: false,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    for (const bad of [
      { seatId: IDS.owner, tools: {} },
      { seatId: IDS.owner, tools: { fly: true } },
      { seatId: IDS.owner, tools: { draw: 'yes' } },
    ])
      expect(seatUpdate.schema.safeParse(bad).success).toBe(false);
  });

  it('a seat with a tool off is refused while the host and co-DM are unaffected', () => {
    const state = withTools(IDS.owner, NONE);
    for (const tool of ['draw', 'measure', 'pins'] as const) {
      expect(canUseTool(state, ACTORS.host, IDS.scene, tool)).toBe(true);
      expect(canUseTool(state, ACTORS.coDm, IDS.scene, tool)).toBe(true);
      expect(canUseTool(state, ACTORS.owner, IDS.scene, tool)).toBe(false);
    }
  });

  it('never allows spectators, mods or unknown scenes', () => {
    const state = withTools(IDS.owner, ALL);
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'draw')).toBe(true);
    expect(canUseTool(state, ACTORS.spectator, IDS.scene, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.mod, IDS.scene, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.owner, IDS.other, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.host, IDS.other, 'draw')).toBe(false);
  });

  it('composes with the seat switch: both must allow, and the switch binds co-DMs too', () => {
    const state = withTools(IDS.owner, ALL);
    const owner = state.seats[IDS.owner];
    const coDm = state.seats[IDS.coDm];
    if (!owner || !coDm) throw new Error('seats');
    owner.interactionEnabled = false;
    coDm.interactionEnabled = false;
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.coDm, IDS.scene, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.host, IDS.scene, 'draw')).toBe(true);
  });

  it('the host revokes Draw and Ping on one Player seat; that seat is denied, others keep them', () => {
    const before = makeCampaign();
    for (const id of [IDS.owner, IDS.other]) {
      const seat = before.seats[id];
      if (!seat) throw new Error('seat');
      seat.tools = { ...seatTemplate('player').tools };
    }
    const payload = { seatId: IDS.owner, tools: { draw: false, pins: false } };
    expect(permissionMatrix(before, 'seat.update', payload)).toMatchObject({
      host: true,
      coDm: false,
      owner: false,
      otherSeat: false,
    });
    const { state } = reduceAction(before, envelope('seat.update', payload));
    expect(state.seats[IDS.owner]?.tools).toEqual({
      measure: true,
      draw: false,
      pins: false,
      interact: false,
    });
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'measure')).toBe(true);
    expect(canUseTool(state, ACTORS.owner, IDS.scene, 'draw')).toBe(false);
    expect(canUseTool(state, ACTORS.owner, IDS.scene, PING_TOOL)).toBe(false);
    expect(canUseTool(state, ACTORS.otherSeat, IDS.scene, 'draw')).toBe(true);
    expect(canUseTool(state, ACTORS.otherSeat, IDS.scene, PING_TOOL)).toBe(true);
  });

  it('no seat tool grants entity.create: a player with every tool still cannot create', () => {
    const state = withTools(IDS.owner, ALL);
    const payload = { sceneId: IDS.scene, entity: makeEntity(testId(40), { layer: 'props' }) };
    expect(canPerform(state, ACTORS.owner, 'entity.create', payload)).toBe(false);
    expect(canPerform(state, ACTORS.host, 'entity.create', payload)).toBe(true);
  });

  it('gates exactly the measure, draw and ping channels', () => {
    expect({ ...TOOL_FOR_CHANNEL }).toEqual({
      'ruler.preview': 'measure',
      [DRAW_STROKE_CHANNEL]: 'draw',
      [PING_CHANNEL]: 'pins',
    });
  });

  it('gates the measure, draw and ping channels; erase, clear and cursors are not tools', () => {
    expect(TOOL_FOR_CHANNEL['ruler.preview']).toBe('measure');
    expect(TOOL_FOR_CHANNEL[DRAW_STROKE_CHANNEL]).toBe('draw');
    expect(TOOL_FOR_CHANNEL[PING_CHANNEL]).toBe(PING_TOOL);
    expect(PING_TOOL).toBe('pins');
    expect(TOOL_FOR_CHANNEL[DRAW_ERASE_CHANNEL]).toBeUndefined();
    expect(TOOL_FOR_CHANNEL[DRAW_CLEAR_CHANNEL]).toBeUndefined();
    expect(TOOL_FOR_CHANNEL['cursor']).toBeUndefined();
  });
});

describe('demoting a Co-DM (UX-46)', () => {
  const demote = (tools: SeatTools | undefined) => {
    const before = makeCampaign();
    const seat = before.seats[IDS.coDm];
    if (!seat) throw new Error('seat');
    if (tools) seat.tools = tools;
    else delete seat.tools;
    const { state } = reduceAction(
      before,
      envelope('seat.update', { seatId: IDS.coDm, role: 'player' }),
    );
    return state.seats[IDS.coDm]?.tools;
  };

  it('resets template or absent tools to the frozen fallback (measure only)', () => {
    const fallback = { measure: true, draw: false, pins: false, interact: false };
    // ALL is a v11 Co-DM seat (no `interact` key): a missing key still matches the template.
    expect(demote(ALL)).toEqual(fallback);
    expect(demote({ ...ALL, interact: false })).toEqual(fallback);
    expect(demote(undefined)).toEqual(fallback);
    expect(fallback).toEqual(DEFAULT_SEAT_TOOLS);
  });

  it('keeps an explicit override, such as a migrated 0.0.1 value', () => {
    const migrated = { measure: false, draw: true, pins: false };
    expect(demote(migrated)).toEqual(migrated);
  });
});

describe('retired scene.setPlayerToggles (UX-46)', () => {
  const payload = { sceneId: IDS.scene, toggles: { draw: true, measure: false } };

  it('no one may send it any more, not even the host', () => {
    expect(permissionMatrix(makeCampaign(), 'scene.setPlayerToggles', payload)).toEqual({
      host: false,
      coDm: false,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    expect(sceneSetPlayerToggles.schema.safeParse(payload).success).toBe(true);
  });

  it('a replayed entry for the only playable scene applies to every seat', () => {
    const { state } = reduceAction(makeCampaign(), envelope('scene.setPlayerToggles', payload));
    for (const seat of Object.values(state.seats))
      expect(seat.tools).toEqual({ measure: false, draw: true, pins: false });
    expect(JSON.stringify(state.scenes)).not.toContain('playerToggles');
  });

  it('a replayed entry for a DM-only scene changes nothing', () => {
    const before = makeCampaign();
    const scene = before.scenes[IDS.scene];
    if (!scene) throw new Error('scene');
    scene.dmOnly = true;
    const { state } = reduceAction(before, envelope('scene.setPlayerToggles', payload));
    for (const seat of Object.values(state.seats)) expect(seat.tools).toBeUndefined();
  });

  it('with two playable scenes a replay may lower a tool but never raise it', () => {
    const before = makeCampaign();
    const scene = before.scenes[IDS.scene];
    if (!scene) throw new Error('scene');
    before.scenes[IDS.other] = { ...scene, id: IDS.other, name: 'Second' };
    const { state } = reduceAction(before, envelope('scene.setPlayerToggles', payload));
    // measure lowered to false; the draw raise is refused (the other scene may still be off).
    for (const seat of Object.values(state.seats))
      expect(seat.tools).toEqual({ measure: false, draw: false, pins: false });
  });
});
