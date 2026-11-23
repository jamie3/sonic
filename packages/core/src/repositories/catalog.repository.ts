import { type Insertable, type Kysely, sql, type Updateable } from "kysely";
import type { CatalogFacets, CatalogSearchQuery } from "@sonic/shared";
import type { CatalogEntryTable, Database } from "../db/types.js";
import type { ReleaseRow } from "../mappers/release.mapper.js";
import type { Owner } from "./owner.js";

/** A catalog entry joined with its release; `entry_id` is the entry id, `id` the release id. */
export type CatalogEntryWithRelease = ReleaseRow & {
  entry_id: string;
  condition: string | null;
  location: string | null;
  purchase_price: number | string | null;
  purchase_date: string | Date | null;
  notes: string | null;
  approved_at: Date;
  capture_id: string | null;
};

/** Data access for catalog entries. */
export class CatalogRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** One page of matching entry ids (newest first) plus the total match count. */
  async search(q: CatalogSearchQuery, owner: Owner): Promise<{ ids: string[]; total: number }> {
    let base = this.db
      .selectFrom("catalog_entry as ce")
      .innerJoin("release as r", "r.id", "ce.release_id")
      .where("ce.deleted_at", "is", null)
      .$if(owner !== null, (q) => q.where("ce.user_id", "=", owner!));

    if (q.q) {
      base = base.where((eb) =>
        eb.or([eb("r.artist", "ilike", `%${q.q}%`), eb("r.title", "ilike", `%${q.q}%`)]),
      );
    }
    if (q.artist) base = base.where("r.artist", "ilike", `%${q.artist}%`);
    if (q.label) base = base.where(sql`lower(r.label)`, "=", q.label.trim().toLowerCase());
    if (q.country) base = base.where(sql`lower(r.country)`, "=", q.country.trim().toLowerCase());
    if (q.year) base = base.where("r.year", "=", q.year);
    if (q.yearFrom) base = base.where("r.year", ">=", q.yearFrom);
    if (q.yearTo) base = base.where("r.year", "<=", q.yearTo);
    if (q.location) base = base.where("ce.location", "ilike", `%${q.location}%`);
    if (q.condition) base = base.where("ce.condition", "=", q.condition);
    if (q.tag) {
      const tag = q.tag.trim().toLowerCase();
      base = base.where(({ exists, selectFrom }) =>
        exists(
          selectFrom("catalog_entry_tag as cet")
            .innerJoin("tag as t", "t.id", "cet.tag_id")
            .select("cet.tag_id")
            .whereRef("cet.catalog_entry_id", "=", "ce.id")
            .where(sql`lower(t.name)`, "=", tag),
        ),
      );
    }

    const total = await base
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirst();

    const rows = await base
      .select("ce.id as id")
      .orderBy("ce.approved_at", "desc")
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();

    return { ids: rows.map((r) => r.id), total: Number(total?.count ?? 0) };
  }

  /** Labels, countries and years in the owner's live catalog, with counts. */
  async facets(owner: Owner): Promise<CatalogFacets> {
    const live = () =>
      this.db
        .selectFrom("catalog_entry as ce")
        .innerJoin("release as r", "r.id", "ce.release_id")
        .where("ce.deleted_at", "is", null)
        .$if(owner !== null, (q) => q.where("ce.user_id", "=", owner!));
    const top = async (column: "r.label" | "r.country") => {
      const rows = await live()
        .select([sql<string>`min(${sql.ref(column)})`.as("value"), (eb) => eb.fn.countAll<string>().as("count")])
        .where(column, "is not", null)
        .where(sql`trim(${sql.ref(column)})`, "!=", "")
        // Group case-insensitively; show the first spelling.
        .groupBy(sql`lower(${sql.ref(column)})`)
        .orderBy(sql`count(*)`, "desc")
        .orderBy(sql`lower(min(${sql.ref(column)}))`)
        .execute();
      return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
    };
    const [labels, countries, years, missing] = await Promise.all([
      top("r.label"),
      top("r.country"),
      live()
        .select(["r.year", (eb) => eb.fn.countAll<string>().as("count")])
        .where("r.year", "is not", null)
        .groupBy("r.year")
        .orderBy("r.year")
        .execute(),
      live()
        .select([
          sql<string>`count(*) filter (where r.year is null)`.as("year"),
          sql<string>`count(*) filter (where r.country is null or trim(r.country) = '')`.as("country"),
          sql<string>`count(*) filter (where r.label is null or trim(r.label) = '')`.as("label"),
        ])
        .executeTakeFirstOrThrow(),
    ]);
    return {
      labels,
      countries,
      years: years.map((y) => ({ year: y.year!, count: Number(y.count) })),
      missing: { year: Number(missing.year), country: Number(missing.country), label: Number(missing.label) },
    };
  }

  /** A live entry (not in the trash) joined with its release. */
  findById(id: string, owner: Owner): Promise<CatalogEntryWithRelease | undefined> {
    return this.selectWithRelease()
      .where("ce.id", "=", id)
      .where("ce.deleted_at", "is", null)
      .$if(owner !== null, (q) => q.where("ce.user_id", "=", owner!))
      .executeTakeFirst() as Promise<
      CatalogEntryWithRelease | undefined
    >;
  }

  /** Trashed entries with their release and deletion time, most recently deleted first. */
  async listTrashed(owner: Owner): Promise<(CatalogEntryWithRelease & { deleted_at: Date })[]> {
    const rows = await this.selectWithRelease()
      .select("ce.deleted_at")
      .where("ce.deleted_at", "is not", null)
      .$if(owner !== null, (q) => q.where("ce.user_id", "=", owner!))
      .orderBy("ce.deleted_at", "desc")
      .execute();
    return rows as unknown as (CatalogEntryWithRelease & { deleted_at: Date })[];
  }

  /** Any entry's capture id, trashed or not (trash operations). */
  async findCaptureIdIncludingTrashed(
    id: string,
    owner: Owner,
  ): Promise<{ exists: boolean; captureId: string | null }> {
    const row = await this.db
      .selectFrom("catalog_entry")
      .select("capture_id")
      .where("id", "=", id)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .executeTakeFirst();
    return { exists: !!row, captureId: row?.capture_id ?? null };
  }

  /** Move to / take out of the trash. Returns whether a row changed. */
  async setDeleted(id: string, at: Date | null, owner: Owner): Promise<boolean> {
    const r = await this.db
      .updateTable("catalog_entry")
      .set({ deleted_at: at })
      .where("id", "=", id)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .where("deleted_at", at ? "is" : "is not", null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  /** Trashed entries deleted before `cutoff` (the owner's, or everyone's for the daily purge). */
  listTrashedBefore(cutoff: Date, owner: Owner): Promise<{ id: string; capture_id: string | null }[]> {
    return this.db
      .selectFrom("catalog_entry")
      .select(["id", "capture_id"])
      .where("deleted_at", "<", cutoff)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .execute();
  }

  /**
   * Permanently delete an entry that is in the trash (tag links cascade).
   * Refuses live entries. Returns whether a row was deleted.
   */
  async hardDeleteTrashed(id: string, owner: Owner): Promise<boolean> {
    const r = await this.db
      .deleteFrom("catalog_entry")
      .where("id", "=", id)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .where("deleted_at", "is not", null)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  private selectWithRelease() {
    return (
      this.db
        .selectFrom("catalog_entry as ce")
        .innerJoin("release as r", "r.id", "ce.release_id")
        // selectAll("r") brings the release's own `id`; alias the entry id to
        // `entry_id` so it isn't clobbered by the release `id` column.
        .selectAll("r")
        .select([
          "ce.id as entry_id",
          "ce.condition",
          "ce.location",
          "ce.purchase_price",
          "ce.purchase_date",
          "ce.notes",
          "ce.approved_at",
          "ce.capture_id",
        ])
    );
  }

  async findReleaseId(id: string, owner: Owner): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("catalog_entry")
      .select("release_id")
      .where("id", "=", id)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row?.release_id;
  }

  async create(values: Insertable<CatalogEntryTable>): Promise<string> {
    const row = await this.db
      .insertInto("catalog_entry")
      .values(values)
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(id: string, values: Updateable<CatalogEntryTable>, owner: Owner): Promise<void> {
    if (Object.keys(values).length === 0) return;
    await this.db.updateTable("catalog_entry").set(values).where("id", "=", id).$if(owner !== null, (q) => q.where("user_id", "=", owner!)).execute();
  }
}
