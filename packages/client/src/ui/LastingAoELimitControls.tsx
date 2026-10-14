import {
  canPerform,
  DEFAULT_LASTING_AOE_LIMIT,
  LastingAoELimit,
  type Actor,
  type Scene,
} from '@mythic/shared';
import { useState } from 'react';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { useSubmit } from './submit.js';

/** Q27: a scene cap for players; this never creates another seat permission. */
export function LastingAoELimitControls({ scene }: { scene: Scene }) {
  const campaign = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const limit = scene.maxLastingAoEsPerPlayer ?? DEFAULT_LASTING_AOE_LIMIT;
  const [draft, setDraft] = useState<{ base: number; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { send, error } = useSubmit();
  const actor: Actor = isHost ? { kind: 'host' } : { kind: 'seat', ...(seatId ? { seatId } : {}) };
  const text = draft?.base === limit ? draft.value : String(limit);
  const parsed = LastingAoELimit.safeParse(text === '' ? NaN : Number(text));
  const allowed =
    !!campaign &&
    canPerform(campaign, actor, 'scene.update', {
      sceneId: scene.id,
      maxLastingAoEsPerPlayer: limit,
    });
  if (!allowed) return <p>Lasting AoE limit per player: {limit}</p>;
  return (
    <fieldset>
      <legend>Lasting AoEs</legend>
      <label>
        Lasting AoE limit per player
        <input
          type="number"
          min="0"
          max="50"
          value={text}
          disabled={busy}
          onChange={(event) => {
            setDraft({ base: limit, value: event.target.value });
          }}
        />
      </label>
      <button
        type="button"
        disabled={busy || !parsed.success || parsed.data === limit}
        onClick={() => {
          if (!parsed.success || busy) return;
          setBusy(true);
          void send({
            type: 'scene.update',
            sceneId: scene.id,
            payload: { sceneId: scene.id, maxLastingAoEsPerPlayer: parsed.data },
          })
            .then((ok) => {
              if (ok) setDraft(null);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Apply AoE limit
      </button>
      <p>0 prevents player placement. The DM and co-DMs are not capped.</p>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
