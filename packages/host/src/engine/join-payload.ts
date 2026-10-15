import { JoinPayload, PROTOCOL_VERSION } from '@mythic/protocol';
import { campaignThumbnail, type Campaign } from '@mythic/shared';

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
 * whether that holder is online. The result is parsed with the strict wire schema before it leaves.
 */
export function buildJoinPayload(state: Campaign, host: HostProfile | undefined): JoinPayload {
  const name = host?.name.trim();
  // UX-05: the DM's upload, else the sign-out capture (rendered as spectators see the board).
  const screenshot = campaignThumbnail(state);
  return JoinPayload.parse({
    protocol: PROTOCOL_VERSION,
    host: {
      name: name ? name : FALLBACK_HOST_NAME,
      ...(host?.avatar !== undefined ? { avatar: host.avatar } : {}),
    },
    campaign: {
      title: state.name,
      ...(state.icon !== undefined ? { icon: state.icon } : {}),
      ...(screenshot !== undefined ? { screenshot } : {}),
    },
    sceneActive: state.activeSceneId !== null,
    seats: Object.values(state.seats)
      .filter((seat) => !seat.archived && !seat.temporary)
      .map((seat) => ({
        seatId: seat.id,
        label: seat.label,
        role: seat.role,
        ...(seat.icon !== undefined ? { icon: seat.icon } : {}),
        claim: seat.identityId === null ? 'free' : 'claimed',
      })),
  });
}
