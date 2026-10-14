import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const assets = sqliteTable('assets', {
  hash: text('hash').primaryKey(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  ext: text('ext').notNull(),
});
