import { Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`create extension if not exists "pgcrypto"`.execute(db); // gen_random_uuid()
  await sql`create extension if not exists "pg_trgm"`.execute(db); // fuzzy search

  await db.schema
    .createTable("release")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("source_id", "text", (c) => c.notNull())
    .addColumn("artist", "text", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("label", "text")
    .addColumn("catalog_number", "text")
    .addColumn("barcode", "text")
    .addColumn("year", "integer")
    .addColumn("country", "text")
    .addColumn("format", "text")
    .addColumn("genres", sql`text[]`)
    .addColumn("styles", sql`text[]`)
    .addColumn("cover_url", "text")
    .addColumn("tracklist", "jsonb")
    .addColumn("raw", "jsonb")
    .addColumn("cached_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("release_source_unique", ["source", "source_id"])
    .execute();

  await db.schema
    .createTable("capture")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("barcode_hint", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("resolved_at", "timestamptz")
    .execute();

  await db.schema
    .createTable("capture_photo")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("capture_id", "uuid", (c) =>
      c.notNull().references("capture.id").onDelete("cascade"),
    )
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("storage_key", "text", (c) => c.notNull())
    .addColumn("width", "integer")
    .addColumn("height", "integer")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("identification_candidate")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("capture_id", "uuid", (c) =>
      c.notNull().references("capture.id").onDelete("cascade"),
    )
    .addColumn("release_id", "uuid", (c) => c.notNull().references("release.id"))
    .addColumn("method", "text", (c) => c.notNull())
    .addColumn("rank", "integer", (c) => c.notNull())
    .addColumn("extracted", "jsonb")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("catalog_entry")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("capture_id", "uuid", (c) => c.references("capture.id").onDelete("set null"))
    .addColumn("release_id", "uuid", (c) => c.notNull().references("release.id"))
    .addColumn("condition", "text")
    .addColumn("location", "text")
    .addColumn("purchase_price", "numeric")
    .addColumn("purchase_date", "date")
    .addColumn("notes", "text")
    .addColumn("approved_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // search indexes
  await sql`create index release_artist_trgm on release using gin (artist gin_trgm_ops)`.execute(db);
  await sql`create index release_title_trgm on release using gin (title gin_trgm_ops)`.execute(db);
  await db.schema
    .createIndex("catalog_entry_release_idx")
    .on("catalog_entry")
    .column("release_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("catalog_entry").ifExists().execute();
  await db.schema.dropTable("identification_candidate").ifExists().execute();
  await db.schema.dropTable("capture_photo").ifExists().execute();
  await db.schema.dropTable("capture").ifExists().execute();
  await db.schema.dropTable("release").ifExists().execute();
}
