import type { Draft } from 'immer';
import type { Campaign } from '../schema/index.js';

/** UX-03: historical entities return intact, but archived seats cannot regain ownership. */
export function removeArchivedOwners(draft: Draft<Campaign>): void {
  for (const scene of Object.values(draft.scenes))
    for (const entity of Object.values(scene.entities))
      if (entity.owners.some((id) => draft.seats[id]?.archived))
        entity.owners = entity.owners.filter((id) => !draft.seats[id]?.archived);
}
