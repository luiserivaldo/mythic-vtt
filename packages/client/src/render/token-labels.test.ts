import { Seat } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import { labelVisible, type LabelSubject } from './token-labels.js';
import type { SelectionActor } from '../tools/selection.js';

const seat = Seat.parse({
  id: tid(1),
  label: 'P',
  binding: 'persistent',
  identityId: null,
  role: 'player',
  permissions: { view: true, move: true, edit: false, delete: false },
});
const player: SelectionActor = { kind: 'seat', seat };
const subject = (over: Partial<LabelSubject> = {}): LabelSubject => ({
  name: 'Goblin',
  layer: 'tokens',
  owners: [],
  labelVisibility: 'all',
  ...over,
});

describe('labelVisible (TOK-04)', () => {
  it('shows "all" labels to players and spectators', () => {
    expect(labelVisible(subject(), player)).toBe(true);
    expect(labelVisible(subject(), { kind: 'spectator' })).toBe(true);
  });
  it('shows "owner" labels only to owners and admins', () => {
    const s = subject({ labelVisibility: 'owner' });
    expect(labelVisible(s, player)).toBe(false);
    expect(labelVisible({ ...s, owners: [seat.id] }, player)).toBe(true);
    expect(labelVisible(s, { kind: 'host' })).toBe(true);
    expect(labelVisible(s, { kind: 'spectator' })).toBe(false);
  });
  it('shows "dm" labels only to host and co-DM', () => {
    const s = subject({ labelVisibility: 'dm', owners: [seat.id] });
    expect(labelVisible(s, player)).toBe(false);
    expect(labelVisible(s, { kind: 'host' })).toBe(true);
    expect(labelVisible(s, { kind: 'seat', seat: { ...seat, role: 'codm' } })).toBe(true);
  });
  it('never labels entities the viewer cannot see', () => {
    expect(labelVisible(subject({ layer: 'dm' }), player)).toBe(false);
    expect(labelVisible(subject({ layer: 'dm' }), { kind: 'spectator' })).toBe(false);
    expect(labelVisible(subject({ perms: { view: false } }), player)).toBe(false);
    expect(
      labelVisible(subject(), {
        kind: 'seat',
        seat: { ...seat, permissions: { ...seat.permissions, view: false } },
      }),
    ).toBe(false);
  });
  it('hides blank names', () => {
    expect(labelVisible(subject({ name: '  ' }), { kind: 'host' })).toBe(false);
  });
});
