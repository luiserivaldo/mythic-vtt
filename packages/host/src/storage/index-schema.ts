import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** UX-05: start of the newest session; null until the campaign is first opened. */
  lastPlayedAt: integer('last_played_at'),
  /** UX-05: `campaignThumbnail` of the saved campaign, an asset hash linked to it. */
  thumbnail: text('thumbnail'),
});
export const assets = sqliteTable('assets', {
  hash: text('hash').primaryKey(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  ext: text('ext').notNull(),
});
