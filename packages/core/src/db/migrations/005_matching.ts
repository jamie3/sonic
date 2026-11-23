/**
 * Matching stage: after extraction ("review"), the matcher searches Discogs with
 * the extracted fields, scores each candidate against what the AI read (the
 * quality check), and records the outcome. Then the owner approves.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("identification_candidate")
    .addColumn("score", "real")
    .addColumn("agreement", "jsonb")
    .execute();

  await db.schema
    .createTable("capture_match")
    .addColumn("capture_id", "uuid", (c) =>
      c.primaryKey().references("capture.id").onDelete("cascade"),
    )
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("outcome", "text", (c) => c.notNull()) // matched | no_match | skipped | error
    .addColumn("message", "text")
    .addColumn("queries", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("matched_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("capture_match").execute();
  await db.schema
    .alterTable("identification_candidate")
    .dropColumn("score")
    .dropColumn("agreement")
    .execute();
}
