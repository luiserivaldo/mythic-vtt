import { Seat } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import type { SelectionActor } from '../tools/selection.js';
import { LABEL_TEXT_COLOR } from './canvas-style.js';
import { HIDDEN_TOKEN_NAME, type LabelSubject } from './token-labels.js';
import { previewAnchor, previewName, previewValueColor } from './token-preview.js';

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

describe('previewName (UI-TOKEN-01, TOK-04, D35)', () => {
  it('prints the name a host or co-DM may read whatever the label mode', () => {
    for (const labelVisibility of ['all', 'owner', 'dm'] as const)
      expect(previewName(subject({ labelVisibility }), { kind: 'host' })).toBe('Goblin');
  });

  it('prints the stand-in, never the name, for a label this viewer may not read', () => {
    expect(previewName(subject({ labelVisibility: 'owner' }), player)).toBe(HIDDEN_TOKEN_NAME);
    expect(previewName(subject({ labelVisibility: 'dm' }), player)).toBe(HIDDEN_TOKEN_NAME);
    expect(previewName(subject({ labelVisibility: 'owner' }), { kind: 'spectator' })).toBe(
      HIDDEN_TOKEN_NAME,
    );
    // The owner of an owner-only label reads it.
    expect(previewName(subject({ labelVisibility: 'owner', owners: [seat.id] }), player)).toBe(
      'Goblin',
    );
  });

  it('prints the stand-in for a token this viewer may not see at all', () => {
    expect(previewName(subject({ layer: 'dm' }), player)).toBe(HIDDEN_TOKEN_NAME);
    expect(previewName(subject({ perms: { view: false } }), player)).toBe(HIDDEN_TOKEN_NAME);
  });

  it('never prints an empty name: a host-blanked or unnamed token reads as the stand-in', () => {
    expect(previewName(subject({ name: '' }), { kind: 'host' })).toBe(HIDDEN_TOKEN_NAME);
    expect(previewName(subject({ name: '   ' }), player)).toBe(HIDDEN_TOKEN_NAME);
    expect(previewName(subject({ name: '', labelVisibility: 'owner' }), player)).toBe(
      HIDDEN_TOKEN_NAME,
    );
  });
});

describe('previewAnchor (UI-TOKEN-01)', () => {
  it('sits above the token in 2D, on the top-down camera up axis (world -Z)', () => {
    // The 2D camera's screen up is world -Z, so "above the token" is a smaller Z, not a larger Y.
    const [x, y, z] = previewAnchor('2d', [4, 0, 7], 1);
    expect([x, y]).toEqual([4, 0]);
    expect(z).toBeCloseTo(7 - 1.1);
    // A Huge token (3 cells) is pushed half its footprint further up.
    const [, , hugeZ] = previewAnchor('2d', [4, 2, 7], 3);
    expect(hugeZ).toBeCloseTo(7 - 2.1);
  });

  it('sits above the 3D standee, above its label anchor', () => {
    const [x, y, z] = previewAnchor('3d', [4, 2, 7], 1);
    expect(x).toBe(4);
    expect(z).toBe(7);
    // The label anchor for one cell is base 0.06 + height 1.2 + gap 0.2; the card clears it.
    expect(y).toBeCloseTo(2 + 1.46 + 0.6);
  });

  it('clamps a malformed footprint to one cell instead of anchoring at NaN', () => {
    for (const sizeCells of [Number.NaN, Infinity, -Infinity, 0, -3]) {
      for (const mode of ['2d', '3d'] as const) {
        const anchor = previewAnchor(mode, [1, 0, 2], sizeCells);
        expect(anchor.every(Number.isFinite)).toBe(true);
        expect(anchor).toEqual(previewAnchor(mode, [1, 0, 2], 1));
      }
    }
  });
});

describe('previewValueColor (UI-TOKEN-01, §8)', () => {
  it('keeps a colour the card can read on its dark background', () => {
    expect(previewValueColor('#ffd166')).toBe('#ffd166');
    expect(previewValueColor('#ffffff')).toBe('#ffffff');
  });

  it('falls back to the card text colour for a value colour that vanishes into the card', () => {
    for (const color of ['#111827', '#000000', '#0f172a', '#101828'])
      expect(previewValueColor(color)).toBe(LABEL_TEXT_COLOR);
  });

  it('uses the card text colour when the field carries no colour at all (not shared)', () => {
    expect(previewValueColor(null)).toBe(LABEL_TEXT_COLOR);
  });
});
