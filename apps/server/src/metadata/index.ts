/**
 * Metadata source seam (architecture.md §4.5). Discogs primary, MusicBrainz
 * fallback. Results are normalized to @sonic/shared shapes and cached by callers.
 */
import type { ReleaseDetail, ReleaseMatch } from "@sonic/shared";

export interface TextQuery {
  artist?: string;
  title?: string;
  label?: string;
  catalogNumber?: string;
}

export interface MetadataSource {
  readonly name: "discogs" | "musicbrainz";
  searchByBarcode(barcode: string): Promise<ReleaseMatch[]>;
  searchByCatalogNumber(cat: string): Promise<ReleaseMatch[]>;
  searchByText(q: TextQuery): Promise<ReleaseMatch[]>;
  getRelease(sourceId: string): Promise<ReleaseDetail>;
}

/**
 * Discogs implementation.
 * TODO: wire to https://api.discogs.com (token auth, ~60 req/min — respect rate
 * limits; the worker's concurrency cap + pg-boss retries handle throttling).
 */
export class DiscogsSource implements MetadataSource {
  readonly name = "discogs" as const;

  constructor(
    private token: string | undefined,
    private userAgent: string,
  ) {}

  async searchByBarcode(_barcode: string): Promise<ReleaseMatch[]> {
    throw new Error("DiscogsSource.searchByBarcode not implemented");
  }
  async searchByCatalogNumber(_cat: string): Promise<ReleaseMatch[]> {
    throw new Error("DiscogsSource.searchByCatalogNumber not implemented");
  }
  async searchByText(_q: TextQuery): Promise<ReleaseMatch[]> {
    throw new Error("DiscogsSource.searchByText not implemented");
  }
  async getRelease(_sourceId: string): Promise<ReleaseDetail> {
    throw new Error("DiscogsSource.getRelease not implemented");
  }
}

import { config } from "../config.js";

export const discogs = new DiscogsSource(config.DISCOGS_TOKEN, config.DISCOGS_USER_AGENT);
// export const musicbrainz = new MusicBrainzSource(...); // fallback, later
