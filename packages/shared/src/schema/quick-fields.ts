import { z } from 'zod';

export const QuickFieldId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/)
  .refine((id) => id !== 'constructor' && id !== 'prototype');
export const QuickField = z.strictObject({
  value: z.number(),
  visibility: z.enum(['all', 'owner', 'dm']),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type QuickField = z.infer<typeof QuickField>;
export const QuickFields = z
  .record(QuickFieldId, QuickField)
  .refine((fields) => Object.keys(fields).length <= 32, 'at most 32 quick fields');

export const QuickFieldSelection = z
  .tuple([QuickFieldId, QuickFieldId, QuickFieldId])
  .refine((ids) => new Set(ids).size === 3, 'choose three different fields');
export type QuickFieldSelection = z.infer<typeof QuickFieldSelection>;
