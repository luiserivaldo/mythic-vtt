import type { SelectionActor } from '../tools/selection.js';

export interface LabelSubject {
  name: string;
  layer: 'map' | 'props' | 'tokens' | 'dm' | 'effects';
  owners: readonly string[];
  perms?: { view?: boolean | undefined } | undefined;
  labelVisibility: 'all' | 'owner' | 'dm';
}

/**
 * D35: `visible` is a readable name, `hidden` is a token the viewer sees but whose label the
 * viewer may not read (the name must be replaced by a neutral placeholder), and `invisible` is a
 * token the viewer must not see at all (never listed, not even as a placeholder).
 */
export type TokenLabelState = 'visible' | 'hidden' | 'invisible';

/** D35: neutral stand-in shown instead of a name this viewer may not read. */
export const HIDDEN_TOKEN_NAME = 'Unknown token';

/**
 * TOK-04 / D35: whether this viewer sees the token's name label. The host already strips entities a
 * client may not see (PERM-03) and blanks a name the audience may not read; this re-checks so a
 * label can never outlive visibility locally.
 */
export function labelState(subject: LabelSubject, actor: SelectionActor): TokenLabelState {
  if (actor.kind === 'host') return 'visible';
  if (actor.kind === 'spectator') {
    if (subject.layer === 'dm') return 'invisible';
    return subject.labelVisibility === 'all' ? 'visible' : 'hidden';
  }
  const { seat } = actor;
  if (seat.role === 'codm') return 'visible';
  if (subject.layer === 'dm') return 'invisible';
  if (!seat.permissions.view || subject.perms?.view === false) return 'invisible';
  if (subject.labelVisibility === 'all') return 'visible';
  if (subject.labelVisibility === 'owner')
    return subject.owners.includes(seat.id) ? 'visible' : 'hidden';
  return 'hidden';
}

/** TOK-04: whether this viewer sees the token's name label; a blank name renders nothing. */
export function labelVisible(subject: LabelSubject, actor: SelectionActor): boolean {
  return subject.name.trim() !== '' && labelState(subject, actor) === 'visible';
}
