import { describe, expect, it } from 'vitest';
import type { SeatPermissions } from '@mythic/shared';
import {
  INTERACTION_OFF_REASON,
  READ_ONLY_REASON,
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
  it('lists the five alpha tools in order, grouped with dividers, and nothing else', () => {
    const states = railToolStates({ ...base, role: 'host', permissions: null });
    expect(states.map((s) => s.id)).toEqual([
      'select',
      'pan',
      'measure',
      'create-prop',
      'initiative',
    ]);
    expect(states.map((s) => s.dividerBefore)).toEqual([false, false, true, true, true]);
    for (const hidden of ['draw', 'pin', 'lighting', 'fog'])
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
      reason: 'Your seat cannot create props',
    });
    expect(by(states, 'select').enabled).toBe(true);
    expect(by(states, 'measure').enabled).toBe(true);
    expect(by(states, 'pan').enabled).toBe(true);
  });

  it('lets a seat granted edit create props', () => {
    const states = railToolStates({ ...base, role: 'player', permissions: perms({ edit: true }) });
    expect(by(states, 'create-prop').enabled).toBe(true);
  });

  it('disables every tool, with one reason, when Enable Interaction is off', () => {
    for (const role of ['host', 'codm', 'player'] as const) {
      const states = railToolStates({
        role,
        permissions: perms({ edit: true }),
        interactionEnabled: false,
      });
      expect(states).toHaveLength(5);
      for (const state of states) {
        expect(state.enabled).toBe(false);
        expect(state.reason).toBe(INTERACTION_OFF_REASON);
      }
    }
  });

  it('lets a spectator pan but gives every other tool a spectator reason', () => {
    const states = railToolStates({ ...base, role: 'observer', permissions: null });
    expect(by(states, 'pan').enabled).toBe(true);
    for (const id of ['select', 'measure', 'create-prop'])
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
    for (const id of ['select', 'measure', 'create-prop'])
      expect(by(states, id).enabled).toBe(false);
    expect(by(states, 'measure').reason).toBe(READ_ONLY_REASON);
    expect(by(states, 'initiative').enabled).toBe(true);
  });

  it('adds a scene-level reason to an otherwise allowed tool', () => {
    const states = railToolStates({
      ...base,
      role: 'player',
      permissions: perms(),
      sceneReasons: { measure: 'Measuring is disabled in this scene' },
    });
    expect(by(states, 'measure')).toMatchObject({
      enabled: false,
      reason: 'Measuring is disabled in this scene',
    });
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
