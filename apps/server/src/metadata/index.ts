/**
 * Metadata source seam (architecture.md §4.5). Discogs primary, MusicBrainz
 * fallback. Results are normalized to @sonic/shared shapes and cached by callers.
 */
import type { ReleaseDetail, ReleaseMatch } from "@sonic/shared";
import { config } from "../config.js";
import { DiscogsSource } from "./discogs.js";

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

export { DiscogsSource } from "./discogs.js";

export const discogs = new DiscogsSource(config.DISCOGS_TOKEN, config.DISCOGS_USER_AGENT);
// export const musicbrainz = new MusicBrainzSource(...); // fallback, later
