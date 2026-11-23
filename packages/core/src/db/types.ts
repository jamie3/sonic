/**
 * Kysely database interface — the source of truth for table shapes.
 * Hand-written (rather than codegen) so the types are reviewable in git and
 * stay in lockstep with the migrations in ./migrations.
 */
import type { ColumnType, Generated } from "kysely";
import type { CaptureStatus, MatchMethod, MediaKind, PhotoType } from "@sonic/shared";

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
  /** Source classifications (e.g. Discogs genres + styles); seeds entry tags on approval. */
  source_tags: string[] | null;
  cover_url: string | null;
  tracklist: Json<unknown> | null;
  raw: Json<unknown> | null;
  cached_at: GeneratedTimestamp;
}

export interface CaptureTable {
  id: Generated<string>;
  /** Owner (users.id). */
  user_id: string;
  status: CaptureStatus;
  /** "vinyl" | "cd" as chosen on the phone; null for older captures. */
  media: MediaKind | null;
  barcode_hint: string | null;
  created_at: GeneratedTimestamp;
  resolved_at: Timestamp | null;
  /** Non-null = in the trash (soft-deleted). */
  deleted_at: Timestamp | null;
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
  /** 0–1 agreement with the extracted data (quality check). */
  score: number | null;
  agreement: Json<unknown> | null;
  created_at: GeneratedTimestamp;
}

export interface CatalogEntryTable {
  id: Generated<string>;
  /** Owner (users.id). */
  user_id: string;
  capture_id: string | null;
  release_id: string;
  condition: string | null;
  location: string | null;
  purchase_price: number | null;
  purchase_date: ColumnType<Date, string, string> | null;
  notes: string | null;
  approved_at: GeneratedTimestamp;
  created_at: GeneratedTimestamp;
  /** Non-null = in the trash (soft-deleted). */
  deleted_at: Timestamp | null;
}

export interface CaptureExtractionTable {
  capture_id: string;
  engine: string;
  model: string | null;
  fields: Json<unknown>;
  raw_text: ColumnType<string, string | undefined, string>;
  error: string | null;
  duration_ms: number | null;
  extracted_at: GeneratedTimestamp;
}

export interface CaptureMatchTable {
  capture_id: string;
  source: string;
  outcome: "matched" | "no_match" | "skipped" | "error";
  message: string | null;
  queries: Json<unknown>;
  matched_at: GeneratedTimestamp;
}

export interface TagTable {
  id: Generated<string>;
  name: string;
  created_at: GeneratedTimestamp;
}

export interface CatalogEntryTagTable {
  catalog_entry_id: string;
  tag_id: string;
}

/** Better Auth user (managed by Better Auth; read here for joins and counts). */
export interface UsersTable {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  username: string | null;
  display_username: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Invite codes: sign-up is invite-only. */
export interface InvitesTable {
  code: string;
  created_by: string | null;
  created_at: GeneratedTimestamp;
  expires_at: Timestamp | null;
  /** Held by a sign-up in progress. */
  claimed_at: Timestamp | null;
  used_at: Timestamp | null;
  used_by: string | null;
}

export interface Database {
  release: ReleaseTable;
  capture: CaptureTable;
  capture_photo: CapturePhotoTable;
  identification_candidate: IdentificationCandidateTable;
  catalog_entry: CatalogEntryTable;
  capture_extraction: CaptureExtractionTable;
  capture_match: CaptureMatchTable;
  tag: TagTable;
  catalog_entry_tag: CatalogEntryTagTable;
  users: UsersTable;
  invites: InvitesTable;
}
