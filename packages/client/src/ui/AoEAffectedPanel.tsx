import type { Scene } from '@mythic/shared';
import { useAoEHighlights } from '../render/use-aoe-highlights.js';

/** Screen-space HTML keeps affected names readable and enforces D35's redacted-name boundary. */
export function AoEAffectedPanel({ scene }: { scene: Scene | null }) {
  const highlights = useAoEHighlights(scene);
  if (highlights.aoeCount === 0) return null;
  return (
    <section className="ui-panel ui-overlay ui-aoe-affected" aria-label="Affected tokens">
      <strong>Affected</strong>
      <span className="ui-aoe-affected-count">
        {highlights.tokenIds.length} token{highlights.tokenIds.length === 1 ? '' : 's'} ·{' '}
        {highlights.cells.length} cell{highlights.cells.length === 1 ? '' : 's'}
      </span>
      {highlights.tokenNames.length > 0 ? (
        <ul>
          {highlights.tokenNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : (
        <span className="ui-aoe-affected-empty">No visible token names</span>
      )}
    </section>
  );
}
