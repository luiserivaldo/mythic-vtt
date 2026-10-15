import { JoinPayload, PROTOCOL_VERSION } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';

/** The host's own profile as stored when it connected (never its identity id or secret). */
export interface HostProfile {
  readonly name: string;
  readonly avatar?: string | undefined;
}

const FALLBACK_HOST_NAME = 'Game Master';

/**
 * UX-44 / UI-JOIN-01 / PERM-03: the pre-join view, built field by field from the campaign. It reads
 * no entity, scene or permission data. Temporary seats and archived seats are not listed (F36: an
 * archived seat must never show as "taken"), and a claimed seat reveals neither its holder nor
 * whether that holder is online. Co-DM seats are not listed either: only the host grants them
 * (MV-269), so a link visitor can never claim one. The result is parsed with the strict wire schema before it leaves.
 */
export function buildJoinPayload(state: Campaign, host: HostProfile | undefined): JoinPayload {
  const name = host?.name.trim();
  return JoinPayload.parse({
    protocol: PROTOCOL_VERSION,
    host: {
      name: name ? name : FALLBACK_HOST_NAME,
      ...(host?.avatar !== undefined ? { avatar: host.avatar } : {}),
    },
    campaign: {
      title: state.name,
      ...(state.icon !== undefined ? { icon: state.icon } : {}),
      ...(state.screenshot !== undefined ? { screenshot: state.screenshot } : {}),
    },
    sceneActive: state.activeSceneId !== null,
    seats: Object.values(state.seats)
      .filter((seat) => !seat.archived && !seat.temporary && seat.role !== 'codm')
      .map((seat) => ({
        seatId: seat.id,
        label: seat.label,
        role: seat.role,
        ...(seat.icon !== undefined ? { icon: seat.icon } : {}),
        claim: seat.identityId === null ? 'free' : 'claimed',
      })),
  });
}
