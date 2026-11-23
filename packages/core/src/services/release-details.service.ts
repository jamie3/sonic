/**
 * Fills in a cached release's missing details (tracklist, cover, barcode, …)
 * from the full source record. Search hits from the Discogs API carry no
 * tracklist, so a release approved from one would otherwise have no tracks.
 * Tries each source in order (local data-dump copy, then the Discogs API) and
 * only fills empty fields — it never overwrites what's already there.
 */
import type { ReleaseDetail } from "@sonic/shared";
import type { MetadataSource } from "../metadata/index.js";
import type { Repositories } from "../repositories/index.js";

export type FillResult = "filled" | "complete" | "not_found" | "unsupported";

export class ReleaseDetailsService {
  private readonly sources: MetadataSource[];

  constructor(
    private readonly repos: Repositories,
    sources: (MetadataSource | null | undefined)[],
  ) {
    // Distinct, configured sources, in priority order.
    this.sources = [...new Set(sources.filter((s): s is MetadataSource => !!s))];
  }

  /**
   * Fill one release's missing tracklist and/or cover. Sources are tried in
   * order until both are found: the local data-dump copy has tracklists but no
   * images, so a missing cover comes from the Discogs API. Source errors (rate
   * limit, network) propagate only if nothing at all was found.
   */
  async fill(releaseId: string): Promise<FillResult> {
    const row = await this.repos.releases.findById(releaseId);
    if (!row) return "not_found";
    const needTracks = !(Array.isArray(row.tracklist) && row.tracklist.length > 0);
    const needCover = !row.cover_url;
    if (!needTracks && !needCover) return "complete";
    const sources = this.sources.filter((s) => s.name === row.source);
    if (sources.length === 0) return "unsupported";

    let detail: ReleaseDetail | null = null; // first source's answer, for the other fields
    let tracklist: ReleaseDetail["tracklist"] = [];
    let coverUrl: string | undefined;
    let lastError: unknown = null;
    for (const source of sources) {
      try {
        const d = await source.getRelease(row.source_id);
        detail ??= d;
        if (!tracklist.length && d.tracklist.length) tracklist = d.tracklist;
        coverUrl ??= d.coverUrl;
        if ((!needTracks || tracklist.length) && (!needCover || coverUrl)) break; // got what was missing
      } catch (err) {
        lastError = err; // e.g. not in the local copy, or no API token: try the next source
      }
    }
    if (!detail) {
      if (lastError) throw lastError;
      return "not_found";
    }

    await this.repos.releases.update(releaseId, {
      ...(needTracks && tracklist.length ? { tracklist: JSON.stringify(tracklist) } : {}),
      cover_url: row.cover_url ?? coverUrl ?? null,
      barcode: row.barcode ?? detail.barcode ?? null,
      country: row.country ?? detail.country ?? null,
      year: row.year ?? detail.year ?? null,
      label: row.label ?? detail.label ?? null,
      catalog_number: row.catalog_number ?? detail.catalogNumber ?? null,
      format: row.format ?? detail.format ?? null,
      source_tags: row.source_tags?.length ? row.source_tags : detail.suggestedTags?.length ? detail.suggestedTags : null,
    });
    return (needTracks && tracklist.length) || (needCover && coverUrl) ? "filled" : "not_found";
  }

  /** Backfill every catalog release from this source that has no tracklist or no cover. */
  async fillCatalog(source = "discogs"): Promise<{ id: string; result: FillResult | "error"; error?: string }[]> {
    const out: { id: string; result: FillResult | "error"; error?: string }[] = [];
    for (const id of await this.repos.releases.listInCatalogMissingDetails(source)) {
      try {
        out.push({ id, result: await this.fill(id) });
      } catch (err) {
        out.push({ id, result: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }
}
