import type { SelectionActor } from '../tools/selection.js';

export interface LabelSubject {
  name: string;
  layer: 'map' | 'props' | 'tokens' | 'dm' | 'effects';
  owners: readonly string[];
  perms?: { view?: boolean | undefined } | undefined;
  labelVisibility: 'all' | 'owner' | 'dm';
}

/**
 * TOK-04: whether this viewer sees the token's name label. The host already strips entities a
 * client may not see (PERM-03); this re-checks so a label can never outlive visibility locally.
 */
export function labelVisible(subject: LabelSubject, actor: SelectionActor): boolean {
  if (subject.name.trim() === '') return false;
  if (actor.kind === 'host') return true;
  if (actor.kind === 'spectator')
    return subject.layer !== 'dm' && subject.labelVisibility === 'all';
  const { seat } = actor;
  if (seat.role === 'codm') return true;
  if (subject.layer === 'dm') return false;
  if (!seat.permissions.view || subject.perms?.view === false) return false;
  if (subject.labelVisibility === 'all') return true;
  if (subject.labelVisibility === 'owner') return subject.owners.includes(seat.id);
  return false;
}
