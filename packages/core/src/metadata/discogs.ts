/**
 * Discogs metadata source. https://www.discogs.com/developers
 * Auth: personal access token. Rate limit: 60 req/min (authenticated) — the
 * matcher runs serially and pg-boss retries, so we surface 429s as errors.
 */
import type { MediaKind, ReleaseDetail, ReleaseMatch, Track } from "@sonic/shared";
import type { MetadataSource, TextQuery } from "./index.js";

const BASE = "https://api.discogs.com";

interface DiscogsSearchResult {
  id: number;
  title: string; // usually "Artist - Title"
  year?: string | number;
  country?: string;
  format?: string[];
  label?: string[];
  catno?: string;
  barcode?: string[];
  genre?: string[];
  style?: string[];
  thumb?: string;
  cover_image?: string;
}

interface DiscogsReleaseResponse {
  id: number;
  title: string;
  artists?: { name: string }[];
  year?: number;
  country?: string;
  formats?: { name: string; descriptions?: string[] }[];
  labels?: { name: string; catno?: string }[];
  genres?: string[];
  styles?: string[];
  identifiers?: { type: string; value: string }[];
  images?: { uri: string; type: string }[];
  tracklist?: { position: string; title: string; duration?: string }[];
}

/** Split Discogs' combined "Artist - Title" search title. */
function splitTitle(combined: string): { artist: string; title: string } {
  const idx = combined.indexOf(" - ");
  if (idx === -1) return { artist: "", title: combined.trim() };
  return { artist: combined.slice(0, idx).trim(), title: combined.slice(idx + 3).trim() };
}

function toMatch(r: DiscogsSearchResult): ReleaseMatch {
  const { artist, title } = splitTitle(r.title);
  return {
    source: "discogs",
    sourceId: String(r.id),
    artist,
    title,
    label: r.label?.[0],
    catalogNumber: r.catno,
    year: r.year ? Number(r.year) || undefined : undefined,
    country: r.country,
    format: r.format?.join(", "),
    // Discogs lists several identifier strings; keep the first real UPC/EAN.
    barcode: r.barcode?.map((b) => b.replace(/\D/g, "")).find((d) => d.length === 12 || d.length === 13),
    thumbUrl: r.thumb || undefined,
    suggestedTags: [...(r.genre ?? []), ...(r.style ?? [])],
  };
}

export class DiscogsSource implements MetadataSource {
  readonly name = "discogs" as const;

  constructor(
    private token: string | undefined,
    private userAgent: string,
  ) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.token) {
      throw new Error("DISCOGS_TOKEN is not set — required for Discogs search");
    }
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

    const res = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        Authorization: `Discogs token=${this.token}`,
      },
    });
    if (res.status === 429) {
      throw new Error("Discogs rate limit (429) — will retry");
    }
    if (!res.ok) {
      throw new Error(`Discogs ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    }
    return (await res.json()) as T;
  }

  private async search(params: Record<string, string>): Promise<ReleaseMatch[]> {
    const data = await this.get<{ results: DiscogsSearchResult[] }>("/database/search", {
      type: "release",
      ...params,
    });
    return (data.results ?? []).map(toMatch);
  }

  searchByBarcode(barcode: string, media?: MediaKind | null): Promise<ReleaseMatch[]> {
    return this.search({ barcode, format: formatParam(media) });
  }

  searchByCatalogNumber(cat: string, media?: MediaKind | null): Promise<ReleaseMatch[]> {
    return this.search({ catno: cat, format: formatParam(media) });
  }

  searchByText(q: TextQuery): Promise<ReleaseMatch[]> {
    return this.search({
      artist: q.artist ?? "",
      release_title: q.title ?? "",
      label: q.label ?? "",
      catno: q.catalogNumber ?? "",
      format: formatParam(q.media),
    });
  }

  async getRelease(sourceId: string): Promise<ReleaseDetail> {
    const r = await this.get<DiscogsReleaseResponse>(`/releases/${sourceId}`, {});
    const fmt = r.formats?.[0];
    const tracklist: Track[] = (r.tracklist ?? [])
      .filter((t) => t.position) // skip headings
      .map((t) => ({ position: t.position, title: t.title, duration: t.duration || undefined }));
    return {
      source: "discogs",
      sourceId: String(r.id),
      artist: r.artists?.map((a) => a.name).join(", ") ?? "",
      title: r.title,
      label: r.labels?.[0]?.name,
      catalogNumber: r.labels?.[0]?.catno,
      barcode: r.identifiers?.find((i) => i.type.toLowerCase() === "barcode")?.value,
      year: r.year || undefined,
      country: r.country,
      format: fmt ? [fmt.name, ...(fmt.descriptions ?? [])].join(", ") : undefined,
      suggestedTags: [...(r.genres ?? []), ...(r.styles ?? [])],
      coverUrl: r.images?.find((i) => i.type === "primary")?.uri ?? r.images?.[0]?.uri,
      tracklist,
    };
  }
}

/** Discogs search `format` filter for a media kind (empty = no filter). */
function formatParam(media: MediaKind | null | undefined): string {
  return media === "vinyl" ? "Vinyl" : media === "cd" ? "CD" : "";
}
