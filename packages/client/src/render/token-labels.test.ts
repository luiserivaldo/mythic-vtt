import { Seat } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import { labelState, labelVisible, type LabelSubject } from './token-labels.js';
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
    // A spectator relies on the host's D35 blanking: it may follow the owner's seat (SES-11).
    expect(labelVisible({ ...s, name: '' }, { kind: 'spectator' })).toBe(false);
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

describe('labelState (D35 affected-token panel)', () => {
  it('separates a label the viewer may not read from a token the viewer may not see', () => {
    expect(labelState(subject({ labelVisibility: 'owner' }), player)).toBe('hidden');
    expect(labelState(subject({ labelVisibility: 'dm' }), player)).toBe('hidden');
    expect(labelState(subject({ layer: 'dm' }), player)).toBe('invisible');
    expect(labelState(subject({ perms: { view: false } }), player)).toBe('invisible');
    expect(
      labelState(subject(), {
        kind: 'seat',
        seat: { ...seat, permissions: { ...seat.permissions, view: false } },
      }),
    ).toBe('invisible');
  });

  it('never reads a host-redacted blank name as an invisible token', () => {
    // PERM-03: the host blanks the name of a label the audience may not read, so a blank name
    // alone must not be mistaken for an absent token.
    expect(labelState(subject({ name: '', labelVisibility: 'owner' }), player)).toBe('hidden');
    expect(labelState(subject({ name: '' }), player)).toBe('visible');
    expect(labelState(subject({ name: '' }), { kind: 'host' })).toBe('visible');
  });

  it('gives spectators "all" labels and sent owner names, and hosts and co-DMs every label', () => {
    expect(labelState(subject(), { kind: 'spectator' })).toBe('visible');
    // SES-11 / D35: an owner name reaches a spectator only when it follows the owning seat.
    expect(labelState(subject({ labelVisibility: 'owner' }), { kind: 'spectator' })).toBe(
      'visible',
    );
    expect(labelState(subject({ name: '', labelVisibility: 'owner' }), { kind: 'spectator' })).toBe(
      'hidden',
    );
    expect(labelState(subject({ labelVisibility: 'dm' }), { kind: 'spectator' })).toBe('hidden');
    expect(labelState(subject({ layer: 'dm' }), { kind: 'spectator' })).toBe('invisible');
    expect(labelState(subject({ labelVisibility: 'dm' }), { kind: 'host' })).toBe('visible');
    expect(
      labelState(subject({ labelVisibility: 'owner' }), {
        kind: 'seat',
        seat: { ...seat, role: 'codm' },
      }),
    ).toBe('visible');
  });

  it('keeps labelVisible consistent with the three states', () => {
    for (const s of [subject(), subject({ labelVisibility: 'owner' }), subject({ layer: 'dm' })]) {
      for (const actor of [player, { kind: 'host' } as const, { kind: 'spectator' } as const]) {
        expect(labelVisible(s, actor)).toBe(
          labelState(s, actor) === 'visible' && s.name.trim() !== '',
        );
      }
    }
  });
});
