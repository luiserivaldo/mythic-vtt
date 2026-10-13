import type { Scene } from '@mythic/shared';
import { affectedDistanceLabel, type AoEAffectedGroup } from '../render/aoe-highlight.js';
import { useAoEHighlights } from '../render/use-aoe-highlights.js';

const count = (value: number, singular: string): string =>
  `${String(value)} ${singular}${value === 1 ? '' : 's'}`;

/**
 * MEAS-04: one stored AoE with the tokens the host's state puts inside it. Rows come from the
 * shared derivation, so a token the viewer may not see (D35) is already absent from `tokens`.
 */
function AoEAffectedGroupRow({ group, scene }: { group: AoEAffectedGroup; scene: Scene }) {
  return (
    <li className="ui-aoe-affected-group">
      <span className="ui-aoe-affected-group-head">
        {group.name} · {count(group.cellCount, 'cell')}
      </span>
      {group.tokens.length === 0 ? (
        <span className="ui-aoe-affected-empty">No tokens inside</span>
      ) : (
        <ul>
          {group.tokens.map((token) => {
            const distance = affectedDistanceLabel(token.distanceCells, scene.grid);
            return (
              <li
                key={token.id}
                className={token.labelHidden ? 'ui-aoe-affected-hidden' : undefined}
                data-testid="aoe-affected-token"
              >
                <span className="ui-aoe-affected-name">{token.label}</span>
                {distance !== '' && <span className="ui-aoe-affected-distance">{distance}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** Screen-space HTML keeps affected names readable and enforces D35's redacted-name boundary. */
export function AoEAffectedPanel({ scene }: { scene: Scene | null }) {
  const highlights = useAoEHighlights(scene);
  if (!scene || highlights.aoeCount === 0) return null;
  return (
    <section className="ui-panel ui-overlay ui-aoe-affected" aria-label="Affected tokens">
      <strong>Affected</strong>
      <span className="ui-aoe-affected-count">
        {count(highlights.tokenIds.length, 'token')} · {count(highlights.cells.length, 'cell')}
      </span>
      {highlights.groups.length === 0 ? (
        <span className="ui-aoe-affected-empty">No AoE on this scene</span>
      ) : (
        <ul>
          {highlights.groups.map((group) => (
            <AoEAffectedGroupRow
              key={group.entityId ?? `preview-${group.kind}`}
              group={group}
              scene={scene}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
