/**
 * Tables of the local Discogs copy, all named `discogs_*` in the `public`
 * schema. Loaded into a staging schema without indexes (fast COPY), indexed
 * there, then swapped into `public` atomically.
 */
export const LIVE = "public";
export const STAGING = "discogs_staging";

export type Entity = "releases" | "masters" | "artists" | "labels";

export interface TableDef {
  name: string;
  columns: [string, string][];
  /** Run after the load, in order. `$T` is the schema-qualified table. */
  finalize: string[];
}

/** Tables each dump fills. */
export const TABLES: Record<Entity, TableDef[]> = {
  releases: [
    {
      name: "discogs_release",
      columns: [
        ["id", "integer not null"],
        ["title", "text not null"],
        ["artists", "text not null"], // display string, e.g. "Pink Floyd"
        ["artist_ids", "integer[] not null"],
        ["year", "smallint"],
        ["released", "text"],
        ["country", "text"],
        ["master_id", "integer"],
        ["is_main", "boolean not null"],
        ["formats", "text"], // display, e.g. 'Vinyl, LP, Album'
        ["format_names", "text[] not null"], // e.g. {Vinyl}
        ["genres", "text[] not null"],
        ["styles", "text[] not null"],
        ["tracklist", "jsonb not null"],
        ["data_quality", "text"],
      ],
      finalize: [
        "alter table $T add primary key (id)",
        "create index discogs_release_title_trgm on $T using gin (lower(title) gin_trgm_ops)",
        "create index discogs_release_artists_trgm on $T using gin (lower(artists) gin_trgm_ops)",
        "create index discogs_release_artist_ids on $T using gin (artist_ids)",
        "create index discogs_release_master on $T (master_id)",
      ],
    },
    {
      name: "discogs_release_label",
      columns: [
        ["release_id", "integer not null"],
        ["label_id", "integer"],
        ["name", "text not null"],
        ["catno", "text"],
        ["catno_norm", "text"],
      ],
      finalize: [
        "create index discogs_release_label_catno on $T (catno_norm)",
        "create index discogs_release_label_release on $T (release_id)",
      ],
    },
    {
      name: "discogs_release_barcode",
      columns: [
        ["release_id", "integer not null"],
        ["value", "text not null"],
        ["value_norm", "text not null"],
      ],
      finalize: [
        "create index discogs_release_barcode_value on $T (value_norm)",
        "create index discogs_release_barcode_release on $T (release_id)",
      ],
    },
  ],
  masters: [
    {
      name: "discogs_master",
      columns: [
        ["id", "integer not null"],
        ["main_release", "integer"],
        ["title", "text not null"],
        ["artists", "text not null"],
        ["artist_ids", "integer[] not null"],
        ["year", "smallint"],
        ["genres", "text[] not null"],
        ["styles", "text[] not null"],
        ["videos", "jsonb not null"], // [{src, title, duration}] — YouTube previews
        ["data_quality", "text"],
      ],
      finalize: [
        "alter table $T add primary key (id)",
        "create index discogs_master_title_trgm on $T using gin (lower(title) gin_trgm_ops)",
        "create index discogs_master_artist_ids on $T using gin (artist_ids)",
      ],
    },
  ],
  artists: [
    {
      name: "discogs_artist",
      columns: [
        ["id", "integer not null"],
        ["name", "text not null"],
        ["realname", "text"],
        ["name_variations", "text[] not null"],
        ["data_quality", "text"],
      ],
      finalize: [
        "alter table $T add primary key (id)",
        "create index discogs_artist_name_trgm on $T using gin (lower(name) gin_trgm_ops)",
      ],
    },
  ],
  labels: [
    {
      name: "discogs_label",
      columns: [
        ["id", "integer not null"],
        ["name", "text not null"],
        ["parent_name", "text"],
        ["data_quality", "text"],
      ],
      finalize: [
        "alter table $T add primary key (id)",
        "create index discogs_label_name_trgm on $T using gin (lower(name) gin_trgm_ops)",
      ],
    },
  ],
};

export const IMPORT_INFO_DDL = `
  create table if not exists ${LIVE}.discogs_import_info (
    entity text primary key,
    dump_file text not null,
    rows bigint not null,
    imported_at timestamptz not null default now()
  )`;
