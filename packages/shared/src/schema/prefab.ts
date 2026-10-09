import { z } from 'zod';
import { Entity } from './entity.js';
import { Id } from './ids.js';

// ENV-09: keep source visibility metadata; placed copies clear ownership and grants.
export const PrefabEntity = Entity.omit({ id: true })
  .extend({ owners: z.array(Id).optional() })
  .strict();
export const Prefab = z.strictObject({
  id: Id,
  name: z.string().trim().min(1).max(120),
  entity: PrefabEntity,
});
export type Prefab = z.infer<typeof Prefab>;
export const MAX_PREFABS = 500;
export const Prefabs = z
  .record(Id, Prefab)
  .refine((value) => Object.keys(value).length <= MAX_PREFABS);
