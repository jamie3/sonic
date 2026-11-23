import { type Kysely, type Selectable, sql, type Updateable } from "kysely";
import type { ReleaseDetail, ReleaseMatch } from "@sonic/shared";
import type { Database, ReleaseTable } from "../db/types.js";

/** Data access for cached metadata-source releases. */
export class ReleaseRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** Cache a metadata-source release, returning its row id (idempotent on source+id). */
  async upsert(m: ReleaseMatch & Partial<ReleaseDetail>): Promise<string> {
    const row = await this.db
      .insertInto("release")
      .values({
        source: m.source,
        source_id: m.sourceId,
        artist: m.artist,
        title: m.title,
        label: m.label ?? null,
        catalog_number: m.catalogNumber ?? null,
        barcode: m.barcode ?? null,
        year: m.year ?? null,
        country: m.country ?? null,
        format: m.format ?? null,
        source_tags: m.suggestedTags?.length ? m.suggestedTags : null,
        cover_url: m.coverUrl ?? m.thumbUrl ?? null,
        tracklist: m.tracklist ? JSON.stringify(m.tracklist) : null,
        raw: null,
      })
      .onConflict((oc) =>
        oc.columns(["source", "source_id"]).doUpdateSet({ cached_at: new Date() }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findById(id: string): Promise<Selectable<ReleaseTable> | undefined> {
    return this.db.selectFrom("release").selectAll().where("id", "=", id).executeTakeFirst();
  }

  /**
   * Ids of source releases in the catalog (trashed entries included) missing a
   * tracklist (e.g. approved from a Discogs API search hit) or a cover (e.g.
   * matched from the local data-dump copy, which has no images).
   */
  async listInCatalogMissingDetails(source: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("release as r")
      .select("r.id")
      .where("r.source", "=", source)
      .where((eb) =>
        eb.or([
          eb("r.tracklist", "is", null),
          eb(sql`jsonb_array_length(r.tracklist)`, "=", 0),
          eb("r.cover_url", "is", null),
        ]),
      )
      .where((eb) => eb.exists(eb.selectFrom("catalog_entry as e").select("e.id").whereRef("e.release_id", "=", "r.id")))
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * A release row only `entryId` uses, for editing. Returns `releaseId` itself
   * if it's already that entry's own ("edited" copy or hand-entered release);
   * otherwise copies the shared row into a new `edited` release keyed to the
   * entry and returns its id. The copy keeps the source in `raw.basedOn`.
   */
  async ensureOwnCopy(releaseId: string, entryId: string): Promise<string> {
    const row = await this.db.selectFrom("release").selectAll().where("id", "=", releaseId).executeTakeFirstOrThrow();
    if (row.source === "edited" || row.source === "manual" || row.source === "seed") return row.id;
    const copy = await this.db
      .insertInto("release")
      .values({
        source: "edited",
        source_id: entryId,
        artist: row.artist,
        title: row.title,
        label: row.label,
        catalog_number: row.catalog_number,
        barcode: row.barcode,
        year: row.year,
        country: row.country,
        format: row.format,
        source_tags: row.source_tags,
        cover_url: row.cover_url,
        tracklist: row.tracklist === null ? null : JSON.stringify(row.tracklist),
        raw: JSON.stringify({ basedOn: { source: row.source, sourceId: row.source_id } }),
      })
      .onConflict((oc) => oc.columns(["source", "source_id"]).doUpdateSet({ cached_at: new Date() }))
      .returning("id")
      .executeTakeFirstOrThrow();
    return copy.id;
  }

  async findSourceTags(id: string): Promise<string[]> {
    const row = await this.db
      .selectFrom("release")
      .select("source_tags")
      .where("id", "=", id)
      .executeTakeFirst();
    return row?.source_tags ?? [];
  }

  async update(id: string, values: Updateable<ReleaseTable>): Promise<void> {
    if (Object.keys(values).length === 0) return;
    await this.db.updateTable("release").set(values).where("id", "=", id).execute();
  }
}
