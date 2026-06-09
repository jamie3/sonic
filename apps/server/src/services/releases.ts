/** Mapping + caching between DB `release` rows and @sonic/shared shapes. */
import type { ReleaseDetail, ReleaseMatch, Track } from "@sonic/shared";
import { db } from "../db/index.js";

export interface ReleaseRow {
  id: string;
  source: string;
  source_id: string;
  artist: string;
  title: string;
  label: string | null;
  catalog_number: string | null;
  barcode: string | null;
  year: number | null;
  country: string | null;
  format: string | null;
  genres: string[] | null;
  styles: string[] | null;
  cover_url: string | null;
  tracklist: unknown;
}

export function releaseToMatch(r: ReleaseRow): ReleaseMatch {
  return {
    source: r.source as ReleaseMatch["source"],
    sourceId: r.source_id,
    artist: r.artist,
    title: r.title,
    label: r.label ?? undefined,
    catalogNumber: r.catalog_number ?? undefined,
    year: r.year ?? undefined,
    country: r.country ?? undefined,
    format: r.format ?? undefined,
    thumbUrl: r.cover_url ?? undefined,
  };
}

export function releaseToDetail(r: ReleaseRow): ReleaseDetail {
  return {
    ...releaseToMatch(r),
    barcode: r.barcode ?? undefined,
    genres: r.genres ?? [],
    styles: r.styles ?? [],
    coverUrl: r.cover_url ?? undefined,
    tracklist: (r.tracklist as Track[] | null) ?? [],
  };
}

/** Cache a metadata-source release into the DB, returning its row id. */
export async function upsertRelease(
  m: ReleaseMatch & Partial<ReleaseDetail>,
): Promise<string> {
  const row = await db
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
      genres: m.genres ?? null,
      styles: m.styles ?? null,
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
