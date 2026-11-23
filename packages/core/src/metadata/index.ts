/**
 * Metadata source seam (architecture.md §4.5). Discogs — from the local
 * data-dump copy or the API. Results are normalized to @sonic/shared shapes and
 * cached by callers.
 */
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { MediaKind, ReleaseDetail, ReleaseMatch } from "@sonic/shared";
import { config } from "../config.js";
import { db as appDb } from "../db/index.js";
import { DiscogsSource } from "./discogs.js";
import { LocalDiscogsSource } from "./discogs-local.js";

export interface TextQuery {
  artist?: string;
  title?: string;
  label?: string;
  catalogNumber?: string;
  /** Leave out releases of the other media kind (vinyl vs CD). */
  media?: MediaKind | null;
}

/** A search hit; sources may include detail (tracklist, …) that gets cached too. */
export type SourceRelease = ReleaseMatch & Partial<ReleaseDetail>;

export interface MetadataSource {
  readonly name: "discogs" | "musicbrainz";
  searchByBarcode(barcode: string, media?: MediaKind | null): Promise<SourceRelease[]>;
  searchByCatalogNumber(cat: string, media?: MediaKind | null): Promise<SourceRelease[]>;
  searchByText(q: TextQuery): Promise<SourceRelease[]>;
  getRelease(sourceId: string): Promise<ReleaseDetail>;
}

export { DiscogsSource } from "./discogs.js";
export { LocalDiscogsSource } from "./discogs-local.js";

export const discogs = new DiscogsSource(config.DISCOGS_TOKEN, config.DISCOGS_USER_AGENT);

export interface ResolvedSource {
  source: MetadataSource | null;
  /** Searched only when `source` finds nothing: the Discogs API behind the local copy. */
  fallback: MetadataSource | null;
  /** Human-readable, for logs: which source(s) and why. */
  description: string;
}

/**
 * Pick the matching source per DISCOGS_SOURCE. "auto" prefers the local copy
 * (fast, no limits) when it has been imported, then the API with a token. With
 * the local copy, the API (when there's a token and DISCOGS_API_FALLBACK isn't
 * false) is the fallback for captures the local copy can't match.
 */
export async function resolveMetadataSource(): Promise<ResolvedSource> {
  const mode = config.DISCOGS_SOURCE;
  if (mode === "off") return { source: null, fallback: null, description: "off (DISCOGS_SOURCE=off)" };

  if (mode === "local" || mode === "auto") {
    // biome-ignore lint: the discogs_* tables aren't part of the app's Database type.
    const db: Kysely<any> = config.DISCOGS_DATABASE_URL
      ? new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: config.DISCOGS_DATABASE_URL }) }) })
      : appDb;
    const exists = await sql<{ release: boolean; info: boolean }>`
      select to_regclass('public.discogs_release') is not null as release,
             to_regclass('public.discogs_import_info') is not null as info
    `
      .execute(db)
      .then((r) => r.rows[0])
      .catch(() => undefined);
    if (exists?.release) {
      const count = exists.info
        ? (await sql<{ rows: string }>`select rows::text from public.discogs_import_info where entity = 'releases'`.execute(db))
            .rows[0]?.rows
        : undefined;
      const fallback = config.DISCOGS_TOKEN && config.DISCOGS_API_FALLBACK ? discogs : null;
      return {
        source: new LocalDiscogsSource(db),
        fallback,
        description:
          `local Discogs copy${count ? ` (${Number(count).toLocaleString()} releases)` : ""}` +
          (fallback
            ? ", then the Discogs API when that finds nothing"
            : config.DISCOGS_TOKEN
              ? " (API fallback off: DISCOGS_API_FALLBACK=false)"
              : " (no API fallback: DISCOGS_TOKEN not set)"),
      };
    }
    if (mode === "local") throw new Error("DISCOGS_SOURCE=local but the discogs_* tables aren't imported — run `pnpm discogs:import`");
  }

  if (config.DISCOGS_TOKEN) return { source: discogs, fallback: null, description: "Discogs API" };
  return {
    source: null,
    fallback: null,
    description: "none — import the dumps (`pnpm discogs:import`) or set DISCOGS_TOKEN",
  };
}
