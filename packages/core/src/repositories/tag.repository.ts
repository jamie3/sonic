import { type Kysely, sql } from "kysely";
import type { TagSummary } from "@sonic/shared";
import type { Database } from "../db/types.js";
import type { Owner } from "./owner.js";

/** Data access for tags and their links to catalog entries. */
export class TagRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** Tags on the owner's live (non-trashed) entries, with counts, sorted case-insensitively. */
  async listWithCounts(owner: Owner): Promise<TagSummary[]> {
    const rows = await this.db
      .selectFrom("tag as t")
      .innerJoin("catalog_entry_tag as cet", "cet.tag_id", "t.id")
      .innerJoin("catalog_entry as ce", "ce.id", "cet.catalog_entry_id")
      .where("ce.deleted_at", "is", null)
      .$if(owner !== null, (q) => q.where("ce.user_id", "=", owner!))
      .select(["t.name", (eb) => eb.fn.countAll<string>().as("count")])
      .groupBy(["t.id", "t.name"])
      .orderBy(sql`lower(t.name)`)
      .execute();
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  /** Tag names per entry id, each list sorted case-insensitively. */
  async namesForEntries(entryIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(entryIds.map((id) => [id, []]));
    if (entryIds.length === 0) return result;
    const rows = await this.db
      .selectFrom("catalog_entry_tag as cet")
      .innerJoin("tag as t", "t.id", "cet.tag_id")
      .select(["cet.catalog_entry_id as entryId", "t.name"])
      .where("cet.catalog_entry_id", "in", entryIds)
      .orderBy(sql`lower(t.name)`)
      .execute();
    for (const r of rows) result.get(r.entryId)?.push(r.name);
    return result;
  }

  /**
   * Replace an entry's tags. `names` must already be normalized (no
   * case-insensitive duplicates). Existing tags are reused and keep their
   * original casing. Call inside a transaction.
   */
  async setForEntry(entryId: string, names: string[]): Promise<void> {
    await this.db
      .deleteFrom("catalog_entry_tag")
      .where("catalog_entry_id", "=", entryId)
      .execute();
    if (names.length === 0) return;

    const tags = await this.db
      .insertInto("tag")
      .values(names.map((name) => ({ name })))
      // No-op update so RETURNING also yields ids of tags that already exist.
      .onConflict((oc) => oc.expression(sql`lower(name)`).doUpdateSet({ name: sql`tag.name` }))
      .returning("id")
      .execute();

    await this.db
      .insertInto("catalog_entry_tag")
      .values(tags.map((t) => ({ catalog_entry_id: entryId, tag_id: t.id })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** Remove tags no longer attached to any entry. */
  async deleteUnused(): Promise<void> {
    await this.db
      .deleteFrom("tag")
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("catalog_entry_tag as cet")
              .select("cet.tag_id")
              .whereRef("cet.tag_id", "=", "tag.id"),
          ),
        ),
      )
      .execute();
  }
}
