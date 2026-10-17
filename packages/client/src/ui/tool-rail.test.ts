import { describe, expect, it } from 'vitest';
import type { SeatPermissions } from '@mythic/shared';
import {
  INTERACTION_OFF_REASON,
  READ_ONLY_REASON,
  SEAT_TOOL_OFF_REASON,
  SPECTATOR_REASON,
  railToolStates,
  resolveActiveTool,
} from './tool-rail.js';

const perms = (over: Partial<SeatPermissions> = {}): SeatPermissions => ({
  view: true,
  move: true,
  edit: false,
  delete: false,
  ...over,
});
const base = { interactionEnabled: true } as const;
const by = (states: ReturnType<typeof railToolStates>, id: string) => {
  const state = states.find((s) => s.id === id);
  if (!state) throw new Error(`missing ${id}`);
  return state;
};

describe('tool rail states', () => {
  it('lists the six alpha tools in order, grouped with dividers, and nothing else', () => {
    const states = railToolStates({ ...base, role: 'host', permissions: null });
    expect(states.map((s) => s.id)).toEqual([
      'select',
      'pan',
      'measure',
      'draw',
      'create-prop',
      'initiative',
    ]);
    expect(states.map((s) => s.dividerBefore)).toEqual([false, false, true, false, true, true]);
    for (const hidden of ['pin', 'lighting', 'fog'])
      expect(states.some((s) => s.id === hidden)).toBe(false);
  });

  it('enables every implemented tool for the host', () => {
    const states = railToolStates({ ...base, role: 'host', permissions: null });
    expect(states.every((s) => s.enabled)).toBe(true);
    expect(by(states, 'initiative').wip).toBe(false);
    expect(by(states, 'select').wip).toBe(false);
  });

  it('keeps a tool a player may not use, disabled with a reason', () => {
    const states = railToolStates({ ...base, role: 'player', permissions: perms() });
    expect(by(states, 'create-prop')).toMatchObject({
      enabled: false,
      reason: 'Only the DM can create props',
    });
    expect(by(states, 'select').enabled).toBe(true);
    expect(by(states, 'measure').enabled).toBe(true);
    expect(by(states, 'pan').enabled).toBe(true);
  });

  it('keeps Create Prop for the DM and co-DMs, even for a player seat with Edit (MV-290)', () => {
    const player = railToolStates({
      ...base,
      role: 'player',
      permissions: perms({ edit: true, delete: true }),
    });
    expect(by(player, 'create-prop')).toMatchObject({
      enabled: false,
      reason: 'Only the DM can create props',
    });
    const coDm = railToolStates({ ...base, role: 'codm', permissions: perms() });
    expect(by(coDm, 'create-prop').enabled).toBe(true);
  });

  it('disables every tool, with one reason, when Enable Interaction is off', () => {
    for (const role of ['host', 'codm', 'player'] as const) {
      const states = railToolStates({
        role,
        permissions: perms({ edit: true }),
        interactionEnabled: false,
      });
      expect(states).toHaveLength(6);
      for (const state of states) {
        expect(state.enabled).toBe(false);
        expect(state.reason).toBe(INTERACTION_OFF_REASON);
      }
    }
  });

  it('lets a spectator pan but gives every other tool a spectator reason', () => {
    const states = railToolStates({ ...base, role: 'observer', permissions: null });
    expect(by(states, 'pan').enabled).toBe(true);
    for (const id of ['select', 'measure', 'draw', 'create-prop'])
      expect(by(states, id)).toMatchObject({ enabled: false, reason: SPECTATOR_REASON });
  });

  it('keeps a view-only seat on Pan, with the board tools disabled and explained', () => {
    const states = railToolStates({
      ...base,
      role: 'player',
      permissions: perms({ move: false }),
      readOnly: true,
    });
    expect(by(states, 'pan').enabled).toBe(true);
    for (const id of ['select', 'measure', 'draw', 'create-prop'])
      expect(by(states, id).enabled).toBe(false);
    expect(by(states, 'measure').reason).toBe(READ_ONLY_REASON);
    expect(by(states, 'draw').reason).toBe(READ_ONLY_REASON);
    expect(by(states, 'initiative').enabled).toBe(true);
  });

  it("adds the seat's own tool reason to an otherwise allowed tool (UX-46)", () => {
    const states = railToolStates({
      ...base,
      role: 'player',
      permissions: perms(),
      toolReasons: { measure: SEAT_TOOL_OFF_REASON.measure },
    });
    expect(by(states, 'measure')).toMatchObject({
      enabled: false,
      reason: 'The DM has turned off Measure for your seat',
    });
  });

  it('names the ping permission "Ping" in its off reason (MV-288)', () => {
    expect(SEAT_TOOL_OFF_REASON.pins).toBe('The DM has turned off Ping for your seat');
  });

  it('disables Draw, with its own reason, when a seat may not view the board', () => {
    const states = railToolStates({
      ...base,
      role: 'player',
      permissions: perms({ view: false, move: true }),
    });
    expect(by(states, 'draw')).toMatchObject({ enabled: false, reason: 'Your seat cannot draw' });
  });

  it("lets the seat's Draw tool disable Draw, and leaves the host exempt", () => {
    const reason = SEAT_TOOL_OFF_REASON.draw;
    const player = railToolStates({
      ...base,
      role: 'player',
      permissions: perms(),
      toolReasons: { draw: reason },
    });
    expect(by(player, 'draw')).toMatchObject({ enabled: false, reason });
    // PERM-05: the host never gets a seat-tool reason, so no seat setting can lock them out.
    const host = railToolStates({ ...base, role: 'host', permissions: null, toolReasons: {} });
    expect(by(host, 'draw').enabled).toBe(true);
  });

  it('always gives a disabled tool a reason', () => {
    const states = railToolStates({ ...base, role: 'player', permissions: perms() });
    for (const state of states) expect(state.enabled || state.reason !== undefined).toBe(true);
  });
});

describe('resolveActiveTool', () => {
  const player = railToolStates({ ...base, role: 'player', permissions: perms() });
  it('keeps a usable tool', () => {
    expect(resolveActiveTool(player, 'pan')).toBe('pan');
  });
  it('falls back to Select, then Pan, when the requested tool is not usable', () => {
    expect(resolveActiveTool(player, 'create-prop')).toBe('select');
    const spectator = railToolStates({ ...base, role: 'observer', permissions: null });
    expect(resolveActiveTool(spectator, 'create-prop')).toBe('pan');
  });
  it('stays on Select when nothing is usable', () => {
    const off = railToolStates({ role: 'host', permissions: null, interactionEnabled: false });
    expect(resolveActiveTool(off, 'pan')).toBe('select');
  });
});
