import { SEAT_TEMPLATES, type Campaign, type Entity } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import {
  archiveImpact,
  newSeatFields,
  SEAT_TOGGLES,
  SEAT_TOOL_TOGGLES,
  seatRows,
  seatTemplateOptions,
} from './seat-panel.js';

const S = tid(2);
const A = tid(3);
const B = tid(4);
const GONE = tid(5);
const perms = { view: true, move: true, edit: false, delete: false };

const owned = (id: string, name: string, owners: string[]): Entity => ({
  id,
  layer: 'tokens',
  name,
  owners,
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
});

function table(): Campaign {
  const base = makeCampaign();
  return {
    ...base,
    seats: {
      [A]: {
        id: A,
        label: 'Ranger',
        binding: 'persistent',
        identityId: tid(9),
        role: 'player',
        permissions: perms,
        icon: { kind: 'glyph', value: '🏹' },
      },
      [B]: {
        id: B,
        label: 'Bard',
        binding: 'persistent',
        identityId: null,
        role: 'codm',
        permissions: { view: true, move: true, edit: true, delete: true },
        interactionEnabled: false,
        icon: { kind: 'image', hash: 'a'.repeat(64) },
      },
      [GONE]: {
        id: GONE,
        label: 'Old seat',
        binding: 'persistent',
        identityId: null,
        role: 'player',
        permissions: perms,
        archived: true,
      },
    },
    scenes: {
      [S]: {
        id: S,
        name: 'Cave',
        grid: {
          type: 'square',
          sizePx: 70,
          unitsPerCell: 5,
          unitLabel: 'ft',
          diagonal: 'alternating',
          snap: true,
        },
        environment: { background: '#000000' },
        layers: {},
        entities: {
          [tid(6)]: owned(tid(6), 'Wolf', [A]),
          [tid(7)]: owned(tid(7), '', [A, B]),
          [tid(8)]: owned(tid(8), 'Crate', []),
        },
      },
    },
    activeSceneId: S,
  };
}

describe('seat rows (UI-SEAT-01)', () => {
  it('lists active seats by name with icon, colour and role, and skips archived ones', () => {
    const rows = seatRows(table(), [{ seatId: A, connected: true, color: '#123456' }]);
    expect(rows.map((r) => [r.label, r.roleLabel, r.connected])).toEqual([
      ['Bard', 'Co-DM', false],
      ['Ranger', 'Player', true],
    ]);
    const [bard, ranger] = rows;
    expect(ranger?.badge).toEqual({ kind: 'glyph', text: '🏹' });
    expect(ranger?.color).toBe('#123456');
    expect(bard?.badge).toEqual({ kind: 'image', src: `/assets/${'a'.repeat(64)}` });
    expect(bard?.color).toMatch(/^hsl\(\d+ 55% 38%\)$/);
    expect(bard?.interactionEnabled).toBe(false);
    expect(ranger?.interactionEnabled).toBe(true);
  });

  it('falls back to initials and a stable colour for a seat without an icon', () => {
    const campaign = table();
    const ranger = campaign.seats[A];
    if (!ranger) throw new Error('fixture seat missing');
    delete ranger.icon;
    const [first] = seatRows(campaign, null).filter((r) => r.id === A);
    const [again] = seatRows(campaign, null).filter((r) => r.id === A);
    expect(first?.badge).toEqual({ kind: 'initials', text: 'R' });
    expect(first?.color).toBe(again?.color);
  });

  it('offers move own, edit and delete per seat, and no lasting-AoE or view toggle', () => {
    expect(SEAT_TOGGLES.map((t) => t.key)).toEqual(['move', 'edit', 'delete']);
    expect(SEAT_TOGGLES.map((t) => t.label)).toEqual(['Move own tokens', 'Edit', 'Delete']);
    expect(JSON.stringify(SEAT_TOGGLES).toLowerCase()).not.toContain('aoe');
  });
});

describe('add a seat from a template', () => {
  it('offers the permission templates, each saying what a new seat starts with (UX-46)', () => {
    expect(seatTemplateOptions().map((t) => t.id)).toEqual(SEAT_TEMPLATES.map((t) => t.id));
    expect(seatTemplateOptions().map((t) => t.label)).toContain('Co-DM');
    const description = (id: string) => seatTemplateOptions().find((t) => t.id === id)?.description;
    expect(description('player')).toMatch(/Starts with: Measure, Draw, Ping\.$/);
    expect(description('spectator')).toMatch(/Starts with: no board tools\.$/);
    expect(description('codm')).toMatch(/Starts with: every tool\.$/);
  });

  it("shows each seat's own tools, with the fallback default when none are stored (UX-46)", () => {
    expect(SEAT_TOOL_TOGGLES.map((t) => t.label)).toEqual(['Measure', 'Draw', 'Ping', 'Doors']);
    const campaign = table();
    const seat = campaign.seats[A];
    if (!seat) throw new Error('fixture');
    expect(seatRows(campaign, null).find((r) => r.id === A)?.tools).toEqual({
      measure: true,
      draw: false,
      pins: false,
      doors: false,
    });
    // A v11 seat has no `doors` key: it reads as off (MV-303 Q1).
    seat.tools = { measure: false, draw: true, pins: true };
    expect(seatRows(campaign, null).find((r) => r.id === A)?.tools).toEqual({
      ...seat.tools,
      doors: false,
    });
    seat.tools = { measure: false, draw: true, pins: true, doors: true };
    expect(seatRows(campaign, null).find((r) => r.id === A)?.tools).toEqual(seat.tools);
  });

  it("uses the template's role and default permissions, and its label when no name is typed", () => {
    expect(newSeatFields('player', '  ')).toEqual({
      label: 'Player',
      role: 'player',
      permissions: { view: true, move: true, edit: false, delete: false },
      tools: { measure: true, draw: true, pins: true, doors: false },
    });
    expect(newSeatFields('codm', ' Lieutenant ')).toEqual({
      label: 'Lieutenant',
      role: 'codm',
      permissions: { view: true, move: true, edit: true, delete: true },
      tools: { measure: true, draw: true, pins: true, doors: false },
    });
    expect(newSeatFields('spectator', 'Watcher')?.permissions.move).toBe(false);
    expect(newSeatFields('spectator', 'Watcher')?.tools).toEqual({
      measure: false,
      draw: false,
      pins: false,
      doors: false,
    });
  });

  it('refuses names the seat.create schema would reject', () => {
    expect(newSeatFields('player', 'x'.repeat(121))).toBeNull();
  });

  it('never shares the template permissions object', () => {
    const fields = newSeatFields('player', '');
    if (!fields) throw new Error('expected fields');
    fields.permissions.edit = true;
    fields.tools.draw = false;
    expect(SEAT_TEMPLATES.find((t) => t.id === 'player')?.permissions.edit).toBe(false);
    expect(SEAT_TEMPLATES.find((t) => t.id === 'player')?.tools.draw).toBe(true);
  });
});

describe('archive warning (UI-SEAT-03)', () => {
  it('lists the bound login and every entity the seat owns', () => {
    expect(archiveImpact(table(), A)).toEqual({
      label: 'Ranger',
      loginBound: true,
      entities: [
        { key: `${S}/${tid(6)}`, text: 'Wolf in Cave' },
        { key: `${S}/${tid(7)}`, text: 'Unnamed entity in Cave' },
      ],
    });
    expect(archiveImpact(table(), B)?.loginBound).toBe(false);
  });

  it('has nothing to archive for an unknown or already archived seat', () => {
    expect(archiveImpact(table(), GONE)).toBeNull();
    expect(archiveImpact(table(), tid(30))).toBeNull();
  });
});
