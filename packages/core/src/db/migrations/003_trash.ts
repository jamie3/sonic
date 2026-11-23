/**
 * Trash bin: soft delete for catalog entries and (unidentified) captures.
 * A non-null `deleted_at` means "in the trash"; the daily purge job removes
 * rows older than the retention period (default 30 days) and their photos.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("catalog_entry").addColumn("deleted_at", "timestamptz").execute();
  await db.schema.alterTable("capture").addColumn("deleted_at", "timestamptz").execute();

  // Small partial indexes: the trash listing and the purge scan only touch
  // trashed rows, and normal reads filter `deleted_at is null`.
  await sql`create index catalog_entry_trashed_idx on catalog_entry (deleted_at) where deleted_at is not null`.execute(db);
  await sql`create index capture_trashed_idx on capture (deleted_at) where deleted_at is not null`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists catalog_entry_trashed_idx`.execute(db);
  await sql`drop index if exists capture_trashed_idx`.execute(db);
  await db.schema.alterTable("catalog_entry").dropColumn("deleted_at").execute();
  await db.schema.alterTable("capture").dropColumn("deleted_at").execute();
}
