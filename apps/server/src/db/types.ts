/**
 * Kysely database interface — the source of truth for table shapes.
 * Hand-written (rather than codegen) so the types are reviewable in git and
 * stay in lockstep with the migrations in ./migrations.
 */
import type { ColumnType, Generated } from "kysely";
import type { CaptureStatus, MatchMethod, PhotoType } from "@sonic/shared";

// Selected as a Date; on insert accepts Date|string (or omitted when the column
// has a DB default — GeneratedTimestamp). Don't wrap these in Generated<>: that
// nests ColumnType and breaks Kysely's select-type extraction.
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T> = ColumnType<T, string, string>;

export interface ReleaseTable {
  id: Generated<string>;
  source: string; // 'discogs' | 'musicbrainz'
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
  tracklist: Json<unknown> | null;
  raw: Json<unknown> | null;
  cached_at: GeneratedTimestamp;
}

export interface CaptureTable {
  id: Generated<string>;
  status: CaptureStatus;
  barcode_hint: string | null;
  created_at: GeneratedTimestamp;
  resolved_at: Timestamp | null;
}

export interface CapturePhotoTable {
  id: Generated<string>;
  capture_id: string;
  type: PhotoType;
  storage_key: string;
  width: number | null;
  height: number | null;
  created_at: GeneratedTimestamp;
}

export interface IdentificationCandidateTable {
  id: Generated<string>;
  capture_id: string;
  release_id: string;
  method: MatchMethod;
  rank: number;
  extracted: Json<unknown> | null;
  created_at: GeneratedTimestamp;
}

export interface CatalogEntryTable {
  id: Generated<string>;
  capture_id: string | null;
  release_id: string;
  condition: string | null;
  location: string | null;
  purchase_price: number | null;
  purchase_date: ColumnType<Date, string, string> | null;
  notes: string | null;
  approved_at: GeneratedTimestamp;
  created_at: GeneratedTimestamp;
}

export interface Database {
  release: ReleaseTable;
  capture: CaptureTable;
  capture_photo: CapturePhotoTable;
  identification_candidate: IdentificationCandidateTable;
  catalog_entry: CatalogEntryTable;
}
