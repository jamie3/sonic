/**
 * Extraction stage: the extractor app reads a capture's photos (OCR / vision)
 * and stores what it found here, then moves the capture to status "review".
 * One row per capture (re-extraction overwrites).
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("capture_extraction")
    .addColumn("capture_id", "uuid", (c) =>
      c.primaryKey().references("capture.id").onDelete("cascade"),
    )
    .addColumn("engine", "text", (c) => c.notNull())
    .addColumn("model", "text")
    .addColumn("fields", "jsonb", (c) => c.notNull())
    .addColumn("raw_text", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("error", "text")
    .addColumn("duration_ms", "integer")
    .addColumn("extracted_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("capture_extraction").execute();
}
