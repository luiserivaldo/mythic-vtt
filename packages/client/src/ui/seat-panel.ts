import {
  Id,
  resolveSeatTools,
  SEAT_TEMPLATES,
  type Campaign,
  type Seat,
  type SeatTemplateId,
  type ResolvedSeatTools,
  type SeatTool,
  type SeatTools,
} from '@mythic/shared';
import { avatarHue, initialsOf, joinImageUrl } from './join-screen.js';

export const PERMISSION_KEYS = ['view', 'move', 'edit', 'delete'] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * UI-SEAT-02: the per-seat toggles the Seats tab offers, in order. There is deliberately no
 * lasting-AoE toggle (the cap stays a scene setting), and `view` is not offered: a seat that cannot
 * view is not a seat.
 */
export const SEAT_TOGGLES: readonly { key: Exclude<PermissionKey, 'view'>; label: string }[] = [
  { key: 'move', label: 'Move own tokens' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
];

/**
 * UI-SEAT-02 (UX-46, MV-251): the per-seat board tools. They replace the old table-wide and
 * per-scene "players may measure / draw / pin" toggles; co-DM seats may always use every tool.
 */
export const SEAT_TOOL_TOGGLES: readonly { key: SeatTool; label: string }[] = [
  { key: 'measure', label: 'Measure' },
  { key: 'draw', label: 'Draw' },
  { key: 'pins', label: 'Ping' },
  { key: 'doors', label: 'Doors' },
];

export const CODM_TOOLS_NOTE = 'Co-DMs can always use every tool';

/** UI-SEAT-01: the seat's badge: its DM-chosen icon, or initials of its name (UX-44). */
export type SeatBadge =
  | { kind: 'glyph'; text: string }
  | { kind: 'image'; src: string }
  | { kind: 'initials'; text: string };

type PresenceEntry = {
  seatId: string;
  connected: boolean;
  displayName?: string | undefined;
  color?: string | undefined;
};

export interface SeatRow {
  id: string;
  label: string;
  role: Seat['role'];
  interactionEnabled: boolean;
  roleLabel: string;
  occupied: boolean;
  /** From presence; false when unknown or offline. */
  connected: boolean;
  /** SES-07: the name the seated identity connected with, when the host has told us. */
  occupantName: string | undefined;
  permissions: Record<PermissionKey, boolean>;
  /** UI-SEAT-02: the seat's own tools, with the `DEFAULT_SEAT_TOOLS` fallback filled in. */
  tools: ResolvedSeatTools;
  badge: SeatBadge;
  /** The occupant's player colour from presence, else a stable hue from the seat name. */
  color: string;
}

function badgeOf(seat: Seat): SeatBadge {
  if (seat.icon?.kind === 'glyph') return { kind: 'glyph', text: seat.icon.value };
  if (seat.icon?.kind === 'image') return { kind: 'image', src: joinImageUrl(seat.icon.hash) };
  return { kind: 'initials', text: initialsOf(seat.label) };
}

export function seatRows(campaign: Campaign, presence: readonly PresenceEntry[] | null): SeatRow[] {
  const online = new Set((presence ?? []).filter((p) => p.connected).map((p) => p.seatId));
  const names = new Map((presence ?? []).map((p) => [p.seatId, p.displayName]));
  const colors = new Map((presence ?? []).map((p) => [p.seatId, p.color]));
  return Object.values(campaign.seats)
    .filter((seat) => !seat.archived)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((seat) => ({
      id: seat.id,
      label: seat.label,
      role: seat.role,
      interactionEnabled: seat.interactionEnabled !== false,
      // D24: the UI says "Co-DM" for the stored `codm` role.
      roleLabel:
        seat.role === 'codm'
          ? 'Co-DM'
          : !seat.permissions.move && !seat.permissions.edit && !seat.permissions.delete
            ? 'Spectator'
            : 'Player',
      occupied: seat.identityId !== null,
      connected: online.has(seat.id),
      occupantName: names.get(seat.id),
      permissions: {
        view: seat.permissions.view,
        move: seat.permissions.move,
        edit: seat.permissions.edit,
        delete: seat.permissions.delete,
      },
      tools: resolveSeatTools(seat),
      badge: badgeOf(seat),
      color: colors.get(seat.id) ?? `hsl(${String(avatarHue(seat.label))} 55% 38%)`,
    }));
}

export interface SeatTemplateOption {
  id: SeatTemplateId;
  label: string;
  description: string;
}

/**
 * UI-SEAT-01 / UI-SEAT-02 (UX-46): the "Add seat" dropdown lists the permission templates. Each
 * option's description says what a new seat starts with; the seat is then adjusted on its own.
 */
export function seatTemplateOptions(): SeatTemplateOption[] {
  return SEAT_TEMPLATES.map(({ id, label, description, role, tools }) => ({
    id,
    label,
    description: `${description} Starts with: ${templateToolsSummary(role, tools)}.`,
  }));
}

function templateToolsSummary(role: Seat['role'], tools: SeatTools): string {
  if (role === 'codm') return 'every tool';
  const on = SEAT_TOOL_TOGGLES.filter((t) => tools[t.key]).map((t) => t.label);
  return on.length === 0 ? 'no board tools' : on.join(', ');
}

/** The `seat.create` fields for a template: an empty name falls back to the template's label. */
export function newSeatFields(
  templateId: SeatTemplateId,
  typedName: string,
): {
  label: string;
  role: Seat['role'];
  permissions: Seat['permissions'];
  tools: SeatTools;
} | null {
  const template = SEAT_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  const label = typedName.trim() === '' ? template.label : typedName.trim();
  if (!isValidLabel(label)) return null;
  return {
    label,
    role: template.role,
    permissions: { ...template.permissions },
    tools: { ...template.tools },
  };
}

export interface ArchiveImpact {
  label: string;
  loginBound: boolean;
  /** Entities whose ownership becomes unassigned, one line each. */
  entities: { key: string; text: string }[];
}

/** UI-SEAT-03 (UX-03): what archiving a seat affects, listed in the warning before it happens. */
export function archiveImpact(campaign: Campaign, seatId: string): ArchiveImpact | null {
  const seat = campaign.seats[seatId];
  if (!seat || seat.archived) return null;
  return {
    label: seat.label,
    loginBound: seat.identityId !== null,
    entities: Object.values(campaign.scenes).flatMap((scene) =>
      Object.values(scene.entities)
        .filter((entity) => entity.owners.includes(seatId))
        .map((entity) => ({
          key: `${scene.id}/${entity.id}`,
          text:
            `${entity.name || 'Unnamed entity'} in ${scene.name}` +
            (entity.token?.characterInstanceId
              ? ' (character link retained, ownership becomes unassigned)'
              : ''),
        })),
    ),
  };
}

/** Seat labels are required and trimmed by the action schema; mirror it so the button can disable. */
export const isValidLabel = (text: string): boolean => {
  const t = text.trim();
  return t.length >= 1 && t.length <= 120;
};

/** `seat.assign` needs an identity id (a ULID); the host sees no roster, so it is typed in. */
export const isValidIdentityId = (text: string): boolean => Id.safeParse(text.trim()).success;

export interface RosterOption {
  identityId: string;
  /** "Name (id tail)" so two people called the same are told apart. */
  label: string;
}

export interface ConnectedIdentityRow {
  key: string;
  displayName: string;
  seatLabel: string;
  roleLabel: 'Co-DM' | 'Player' | 'Spectator';
}

/** M1-39: the host-only presence feed, joined to seat labels without exposing it to other clients. */
export function connectedIdentityRows(
  campaign: Campaign,
  presence:
    readonly { seatId: string; connected: boolean; displayName?: string | undefined }[] | null,
  unseated: readonly { identityId: string; displayName: string }[] | undefined,
): ConnectedIdentityRow[] {
  const rows: ConnectedIdentityRow[] = [];
  for (const entry of presence ?? []) {
    if (!entry.connected) continue;
    const seat = campaign.seats[entry.seatId];
    if (!seat) continue;
    rows.push({
      key: `seat-${seat.id}`,
      displayName: entry.displayName ?? 'Unnamed player',
      seatLabel: seat.label,
      roleLabel: seat.role === 'codm' ? 'Co-DM' : 'Player',
    });
  }
  for (const entry of unseated ?? []) {
    rows.push({
      key: `identity-${entry.identityId}`,
      displayName: entry.displayName,
      seatLabel: 'Unseated',
      roleLabel: 'Spectator',
    });
  }
  return rows.sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.seatLabel.localeCompare(b.seatLabel),
  );
}

/** M1-11: connected identities without a seat, as dropdown options for `seat.assign`. */
export function rosterOptions(
  unseated: readonly { identityId: string; displayName: string }[] | undefined,
): RosterOption[] {
  return (unseated ?? []).map((u) => ({
    identityId: u.identityId,
    label: `${u.displayName} (${u.identityId.slice(-4)})`,
  }));
}
