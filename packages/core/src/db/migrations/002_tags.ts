/**
 * Tags replace release genres/styles (TODO #15).
 *
 * - `tag` + `catalog_entry_tag`: owner-defined labels on catalog entries.
 *   Names are unique case-insensitively (lower(name) index).
 * - `release.source_tags`: the metadata source's classifications (Discogs
 *   genres + styles), kept only to seed an entry's tags on approval.
 * - Existing entries get tags from their release's genres + styles, then the
 *   old columns are dropped.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("tag")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index tag_name_lower_unique on tag (lower(name))`.execute(db);

  await db.schema
    .createTable("catalog_entry_tag")
    .addColumn("catalog_entry_id", "uuid", (c) =>
      c.notNull().references("catalog_entry.id").onDelete("cascade"),
    )
    .addColumn("tag_id", "uuid", (c) => c.notNull().references("tag.id").onDelete("cascade"))
    .addPrimaryKeyConstraint("catalog_entry_tag_pk", ["catalog_entry_id", "tag_id"])
    .execute();
  await db.schema
    .createIndex("catalog_entry_tag_tag_idx")
    .on("catalog_entry_tag")
    .column("tag_id")
    .execute();

  await db.schema.alterTable("release").addColumn("source_tags", sql`text[]`).execute();

  // genres ++ styles → source_tags: trimmed, blanks dropped, case-insensitive
  // de-dupe keeping the first occurrence, original order preserved.
  await sql`
    update release r set source_tags = (
      select array_agg(t order by ord) from (
        select distinct on (lower(btrim(x))) btrim(x) as t, ord
        from unnest(coalesce(r.genres, '{}') || coalesce(r.styles, '{}')) with ordinality as u(x, ord)
        where btrim(x) <> ''
        order by lower(btrim(x)), ord
      ) s
    )
  `.execute(db);

  // Create tags for every source tag on a release that's in the catalog. When
  // releases disagree on casing ("Krautrock" vs "krautrock"), prefer a variant
  // that isn't all-lowercase, then byte order (uppercase first) — locale-free.
  await sql`
    insert into tag (name)
    select distinct on (lower(t)) t
    from catalog_entry ce
    join release r on r.id = ce.release_id
    cross join unnest(r.source_tags) as t
    order by lower(t), (t = lower(t)), t collate "C"
    on conflict (lower(name)) do nothing
  `.execute(db);

  // …and attach them to those entries.
  await sql`
    insert into catalog_entry_tag (catalog_entry_id, tag_id)
    select ce.id, tg.id
    from catalog_entry ce
    join release r on r.id = ce.release_id
    cross join unnest(r.source_tags) as t
    join tag tg on lower(tg.name) = lower(t)
    on conflict do nothing
  `.execute(db);

  await db.schema.alterTable("release").dropColumn("genres").dropColumn("styles").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("release")
    .addColumn("genres", sql`text[]`)
    .addColumn("styles", sql`text[]`)
    .execute();
  // Best effort: genres/styles were merged on the way up, so restore all of
  // them as genres.
  await sql`update release set genres = source_tags`.execute(db);
  await db.schema.alterTable("release").dropColumn("source_tags").execute();
  await db.schema.dropTable("catalog_entry_tag").execute();
  await db.schema.dropTable("tag").execute();
}
