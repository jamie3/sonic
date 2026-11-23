/** Maps DB `release` rows to @sonic/shared release shapes. */
import type { ReleaseDetail, ReleaseMatch, Track } from "@sonic/shared";

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
  source_tags: string[] | null;
  cover_url: string | null;
  tracklist: unknown;
}

export function toReleaseMatch(r: ReleaseRow): ReleaseMatch {
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
    barcode: r.barcode ?? undefined,
    thumbUrl: r.cover_url ?? undefined,
    suggestedTags: r.source_tags?.length ? r.source_tags : undefined,
  };
}

export function toReleaseDetail(r: ReleaseRow): ReleaseDetail {
  return {
    ...toReleaseMatch(r),
    barcode: r.barcode ?? undefined,
    coverUrl: r.cover_url ?? undefined,
    tracklist: (r.tracklist as Track[] | null) ?? [],
  };
}
