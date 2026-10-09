import { z } from 'zod';
import { Entity } from './entity.js';
import { Id } from './ids.js';

// ENV-09: a reusable configuration carries neither instance identity nor seat grants.
export const PrefabEntity = Entity.omit({ id: true, owners: true, perms: true }).strict();
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
