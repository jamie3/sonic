/**
 * Capture media: whether the item is a vinyl record or a CD, as chosen on the
 * phone. Matching uses it so a vinyl record never matches a CD release (and
 * vice versa). Null for captures made before this existed.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("capture")
    .addColumn("media", "text", (c) => c.check(sql`media in ('vinyl', 'cd')`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("capture").dropColumn("media").execute();
}
