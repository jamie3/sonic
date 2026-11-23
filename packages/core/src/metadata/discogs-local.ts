/**
 * Discogs from the local data-dump copy (`discogs_*` tables, loaded by
 * `pnpm discogs:import`). Same contract as the API client, but no token, no
 * rate limit, works offline, and returns full detail (tracklist, all labels).
 * No cover images — the dumps don't include them.
 */
import { type Kysely, sql } from "kysely";
import type { MediaKind, ReleaseDetail, ReleaseMatch, Track } from "@sonic/shared";
import { FORMAT_NAMES } from "../matching/media.js";
import { normalizeBarcode, normalizeCatno } from "../matching/score.js";
import type { MetadataSource, TextQuery } from "./index.js";

const LIMIT = 25;

type Found = ReleaseMatch & Partial<ReleaseDetail>;

interface Row {
  id: number;
  title: string;
  artists: string;
  year: number | null;
  country: string | null;
  formats: string | null;
  genres: string[];
  styles: string[];
  tracklist: { position: string | null; title: string; duration: string | null }[];
  labels: { name: string; catno: string | null; catno_norm: string | null }[] | null;
  barcode: string | null;
}

export class LocalDiscogsSource implements MetadataSource {
  readonly name = "discogs" as const;

  // biome-ignore lint: Kysely<any> — the discogs_* tables aren't part of the app's Database type.
  constructor(private readonly db: Kysely<any>) {}

  async searchByBarcode(barcode: string, media?: MediaKind | null): Promise<Found[]> {
    const norm = normalizeBarcode(barcode);
    if (norm.length < 8) return [];
    const { rows } = await sql<{ release_id: number }>`
      select distinct b.release_id
      from public.discogs_release_barcode b
      join public.discogs_release r on r.id = b.release_id
      where b.value_norm = ${norm} and ${mediaFilter(media)}
      limit ${LIMIT}
    `.execute(this.db);
    return this.load(rows.map((r) => r.release_id));
  }

  async searchByCatalogNumber(cat: string, media?: MediaKind | null): Promise<Found[]> {
    return this.searchByText({ catalogNumber: cat, media });
  }

  async searchByText(q: TextQuery): Promise<Found[]> {
    if (q.catalogNumber) {
      const norm = normalizeCatno(q.catalogNumber);
      if (!norm) return [];
      const artist = q.artist?.toLowerCase() ?? null;
      const { rows } = await sql<{ release_id: number }>`
        select l.release_id
        from public.discogs_release_label l
        join public.discogs_release r on r.id = l.release_id
        where l.catno_norm = ${norm} and ${mediaFilter(q.media)}
        order by ${artist ? sql`similarity(lower(r.artists), ${artist})` : sql`0`} desc, r.is_main desc
        limit ${LIMIT}
      `.execute(this.db);
      return this.load(
        rows.map((r) => r.release_id),
        norm,
      );
    }

    const title = q.title?.toLowerCase().trim();
    const artist = q.artist?.toLowerCase().trim();
    if (!title && !artist) return [];
    // Trigram similarity (pg_trgm, GIN-indexed): tolerant of spelling/punctuation.
    const conds = [
      title ? sql`lower(title) % ${title}` : null,
      artist ? sql`lower(artists) % ${artist}` : null,
      mediaFilter(q.media, sql`format_names`),
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    const rank = sql.join(
      [
        title ? sql`similarity(lower(title), ${title})` : sql`0`,
        artist ? sql`similarity(lower(artists), ${artist})` : sql`0`,
      ],
      sql` + `,
    );
    const { rows } = await sql<{ id: number }>`
      select id from public.discogs_release
      where ${sql.join(conds, sql` and `)}
      order by ${rank} desc, is_main desc
      limit ${LIMIT}
    `.execute(this.db);
    return this.load(rows.map((r) => r.id));
  }

  async getRelease(sourceId: string): Promise<ReleaseDetail> {
    const [found] = await this.load([Number(sourceId)]);
    if (!found) throw new Error(`Discogs release ${sourceId} not in the local copy`);
    return found as ReleaseDetail;
  }

  /** Every release by an artist (the "complete discography"), newest first. */
  async releasesByArtist(artistId: number, limit = 500): Promise<Found[]> {
    const { rows } = await sql<{ id: number }>`
      select id from public.discogs_release where artist_ids @> array[${artistId}]::int[]
      order by year desc nulls last limit ${limit}
    `.execute(this.db);
    return this.load(rows.map((r) => r.id));
  }

  /** Fetch full rows; `preferCatno` picks which label's catalog number to report. */
  private async load(ids: number[], preferCatno?: string): Promise<Found[]> {
    if (ids.length === 0) return [];
    const { rows } = await sql<Row>`
      select r.id, r.title, r.artists, r.year, r.country, r.formats, r.genres, r.styles, r.tracklist,
        (select json_agg(json_build_object('name', l.name, 'catno', l.catno, 'catno_norm', l.catno_norm))
           from public.discogs_release_label l where l.release_id = r.id) as labels,
        (select b.value_norm from public.discogs_release_barcode b where b.release_id = r.id limit 1) as barcode
      from public.discogs_release r
      where r.id = any(${ids}::int[])
    `.execute(this.db);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Keep the search's ranking order.
    return ids.map((id) => byId.get(id)).filter((r): r is Row => !!r).map((r) => this.toMatch(r, preferCatno));
  }

  private toMatch(r: Row, preferCatno?: string): Found {
    const labels = r.labels ?? [];
    const label = (preferCatno && labels.find((l) => l.catno_norm === preferCatno)) || labels[0];
    const tracklist: Track[] = r.tracklist.map((t) => ({
      position: t.position ?? "",
      title: t.title,
      duration: t.duration ?? undefined,
    }));
    return {
      source: "discogs",
      sourceId: String(r.id),
      artist: r.artists,
      title: r.title,
      label: label?.name,
      catalogNumber: label?.catno ?? undefined,
      year: r.year ?? undefined,
      country: r.country ?? undefined,
      format: r.formats ?? undefined,
      barcode: r.barcode ?? undefined,
      suggestedTags: [...r.genres, ...r.styles],
      tracklist,
    };
  }
}

/**
 * SQL condition keeping only releases of the capture's kind: vinyl only
 * matches vinyl, CD only CD (no files, cassettes, …). A release that includes
 * it (a vinyl + CD box) stays in, as does one with no recorded format — same
 * rule as matching/media.ts#compatibleMedia.
 */
function mediaFilter(media: MediaKind | null | undefined, column = sql`r.format_names`) {
  if (!media) return sql`true`;
  const mine = FORMAT_NAMES[media];
  return sql`(cardinality(${column}) = 0 or ${column} && ${mine}::text[])`;
}
