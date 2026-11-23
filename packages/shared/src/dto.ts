import { z } from "zod";
import { CaptureStatus, Condition, MatchMethod, MediaKind, PhotoType } from "./enums.js";
import { ReleaseDetail, ReleaseMatch } from "./release.js";

// --- Auth ---
export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  username: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

/** The signed-in account, with a summary of the library. */
export const Profile = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(), // ISO
  stats: z.object({
    catalog: z.number().int(), // records in the catalog (not trashed)
    awaitingReview: z.number().int(), // captures in the review queue
    inTrash: z.number().int(),
  }),
});
export type Profile = z.infer<typeof Profile>;

/** An invite code a user created; sign-up is invite-only. */
export const Invite = z.object({
  code: z.string(), // e.g. SONIC-7KQ2-M9XD
  createdAt: z.string(), // ISO
  expiresAt: z.string().nullable(), // ISO
  usedAt: z.string().nullable(), // ISO
  usedBy: z.string().nullable(), // username of who signed up with it
});
export type Invite = z.infer<typeof Invite>;

export const InviteList = z.object({
  invites: z.array(Invite),
  /** How many more unused invites the user may create right now. */
  remaining: z.number().int(),
});
export type InviteList = z.infer<typeof InviteList>;

// --- Captures ---
export const CapturePhoto = z.object({
  id: z.string().uuid(),
  type: PhotoType,
  url: z.string(),
});
export type CapturePhoto = z.infer<typeof CapturePhoto>;

/** How one field the AI read compares with a source candidate (the quality check). */
export const FieldAgreement = z.object({
  field: z.enum(["barcode", "catalogNumber", "artist", "title", "label", "year"]),
  extracted: z.string().nullable(),
  candidate: z.string().nullable(),
  /** match = same; partial = similar; mismatch = different; missing = one side blank. */
  agreement: z.enum(["match", "partial", "mismatch", "missing"]),
});
export type FieldAgreement = z.infer<typeof FieldAgreement>;

export const IdentificationCandidate = z.object({
  id: z.string().uuid(),
  method: MatchMethod,
  rank: z.number().int(),
  release: ReleaseMatch,
  /** 0–1 agreement between what the AI read and this candidate (null for legacy rows). */
  score: z.number().nullable(),
  agreement: z.array(FieldAgreement),
});
export type IdentificationCandidate = z.infer<typeof IdentificationCandidate>;

/** What the extractor read off the photos (all fields optional — only what's legible). */
export const ExtractedRelease = z.object({
  artist: z.string().nullable(),
  title: z.string().nullable(),
  label: z.string().nullable(),
  catalogNumber: z.string().nullable(),
  barcode: z.string().nullable(),
  year: z.number().int().nullable(),
  country: z.string().nullable(),
  format: z.string().nullable(), // e.g. "LP", "12\" single", "CD"
  tracklist: z.array(z.object({ position: z.string().nullable(), title: z.string() })),
});
export type ExtractedRelease = z.infer<typeof ExtractedRelease>;

/** The extractor's result for a capture. */
export const CaptureExtraction = z.object({
  engine: z.string(), // "claude" | "ollama" | "tesseract"
  model: z.string().nullable(),
  fields: ExtractedRelease,
  /** All legible text, verbatim, per photo where the engine provides it. */
  rawText: z.string(),
  /** Set when extraction failed after retries; fields/rawText may be empty. */
  error: z.string().nullable(),
  extractedAt: z.string(), // ISO
});
export type CaptureExtraction = z.infer<typeof CaptureExtraction>;

/** Result of searching online sources (Discogs) with the extracted data. */
export const CaptureMatch = z.object({
  source: z.string(), // "discogs"
  /** matched = candidates found; no_match = searched, nothing; skipped = source not configured; error = gave up. */
  outcome: z.enum(["matched", "no_match", "skipped", "error"]),
  message: z.string().nullable(),
  /** Human-readable searches that were tried, e.g. "barcode 5099902987612". */
  queries: z.array(z.string()),
  matchedAt: z.string(), // ISO
});
export type CaptureMatch = z.infer<typeof CaptureMatch>;

export const Capture = z.object({
  id: z.string().uuid(),
  status: CaptureStatus,
  /** Vinyl or CD, as chosen when capturing; null for older captures. */
  media: MediaKind.nullable(),
  barcodeHint: z.string().nullable(),
  photos: z.array(CapturePhoto),
  candidates: z.array(IdentificationCandidate),
  /** Present once the extractor has processed the photos (status "review"+). */
  extraction: CaptureExtraction.nullable(),
  /** Present once the online-source search has run (pending_* statuses). */
  match: CaptureMatch.nullable(),
  createdAt: z.string(), // ISO
});
export type Capture = z.infer<typeof Capture>;

/** Copy-specific details the owner adds on approval. */
export const CopyDetails = z.object({
  condition: Condition.optional(),
  location: z.string().optional(),
  purchasePrice: z.number().optional(),
  purchaseDate: z.string().optional(), // ISO date
  notes: z.string().optional(),
});
export type CopyDetails = z.infer<typeof CopyDetails>;

/** Approve a single-match capture (optionally choosing a candidate). */
export const ApproveRequest = z.object({
  candidateId: z.string().uuid().optional(), // required when multiple matches
  copy: CopyDetails.optional(),
});
export type ApproveRequest = z.infer<typeof ApproveRequest>;

/** Bulk-approve many single-match captures at once. */
export const BulkApproveRequest = z.object({
  captureIds: z.array(z.string().uuid()).min(1),
});
export type BulkApproveRequest = z.infer<typeof BulkApproveRequest>;

export const BulkApproveResult = z.object({
  approved: z.array(z.string().uuid()),
  skipped: z.array(z.object({ id: z.string().uuid(), reason: z.string() })),
});
export type BulkApproveResult = z.infer<typeof BulkApproveResult>;

/** Ask the matcher to search Discogs again for these captures. */
export const BulkRematchRequest = z.object({
  captureIds: z.array(z.string().uuid()).min(1),
});
export type BulkRematchRequest = z.infer<typeof BulkRematchRequest>;

export const BulkRematchResult = z.object({
  /** Sent back to the matcher (status → review). */
  queued: z.array(z.string().uuid()),
  skipped: z.array(z.object({ id: z.string().uuid(), reason: z.string() })),
});
export type BulkRematchResult = z.infer<typeof BulkRematchResult>;

/** Release data the owner confirms (usually the AI's reading, corrected as needed). */
export const ManualRelease = z.object({
  artist: z.string().trim().min(1),
  title: z.string().trim().min(1),
  label: z.string().trim().nullable().optional(),
  catalogNumber: z.string().trim().nullable().optional(),
  barcode: z.string().trim().nullable().optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  country: z.string().trim().nullable().optional(),
  format: z.string().trim().nullable().optional(),
  tracklist: z.array(z.object({ position: z.string().nullable(), title: z.string() })).optional(),
});
export type ManualRelease = z.infer<typeof ManualRelease>;

/**
 * Approve a capture using the owner-confirmed data instead of a source match —
 * for no-match captures, or when none of the candidates is right.
 */
export const ResolveRequest = z.object({
  manual: ManualRelease,
  copy: CopyDetails.optional(),
});
export type ResolveRequest = z.infer<typeof ResolveRequest>;

// --- Catalog ---
export const CatalogEntry = z.object({
  id: z.string().uuid(),
  release: ReleaseDetail,
  condition: Condition.nullable(),
  location: z.string().nullable(),
  purchasePrice: z.number().nullable(),
  purchaseDate: z.string().nullable(), // ISO date (YYYY-MM-DD)
  notes: z.string().nullable(),
  /** Owner-defined labels: genre, style, category, group, … (sorted by name). */
  tags: z.array(z.string()),
  photos: z.array(CapturePhoto),
  approvedAt: z.string(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

// --- Tags ---
/** A tag name: trimmed, 1–50 chars. Matching is case-insensitive server-side. */
export const TagName = z.string().trim().min(1).max(50);

export const TagSummary = z.object({
  name: z.string(),
  count: z.number().int(), // catalog entries carrying this tag
});
export type TagSummary = z.infer<typeof TagSummary>;

/** Editable release metadata. Identity (source/source_id) and ids are excluded. */
export const UpdateRelease = z
  .object({
    artist: z.string().min(1),
    title: z.string().min(1),
    label: z.string().nullable(),
    catalogNumber: z.string().nullable(),
    barcode: z.string().nullable(),
    year: z.number().int().min(0).max(9999).nullable(),
    country: z.string().nullable(),
    format: z.string().nullable(),
    coverUrl: z.string().url().nullable(),
  })
  .partial();
export type UpdateRelease = z.infer<typeof UpdateRelease>;

/**
 * Patch the editable columns of a catalog entry (and its release). All fields
 * are optional — only those present are updated. `notes: null` clears it.
 */
export const UpdateCatalogEntry = z
  .object({
    condition: Condition.nullable(),
    location: z.string().nullable(),
    purchasePrice: z.number().nullable(),
    purchaseDate: z.string().nullable(),
    notes: z.string().trim().max(2000).nullable(),
    /** Replaces the entry's full tag set. */
    tags: z.array(TagName).max(50),
    release: UpdateRelease,
  })
  .partial();
export type UpdateCatalogEntry = z.infer<typeof UpdateCatalogEntry>;

export const CatalogSearchQuery = z.object({
  q: z.string().optional(),
  artist: z.string().optional(),
  label: z.string().optional(), // exact label name, case-insensitive
  country: z.string().optional(), // exact release country (Discogs: "US", "UK", "Germany", "Europe"…), case-insensitive
  year: z.coerce.number().int().optional(), // exact release year
  yearFrom: z.coerce.number().int().optional(), // release year ≥
  yearTo: z.coerce.number().int().optional(), // release year ≤
  tag: z.string().optional(), // exact tag name, case-insensitive
  location: z.string().optional(),
  condition: Condition.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
});
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuery>;

export const CatalogSearchResult = z.object({
  items: z.array(CatalogEntry),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CatalogSearchResult = z.infer<typeof CatalogSearchResult>;

/** A filter value present in the user's catalog, with how many entries have it. */
export const FacetCount = z.object({ value: z.string(), count: z.number().int() });
export type FacetCount = z.infer<typeof FacetCount>;

/** What the user's catalog can be filtered by (live, non-trashed entries only). */
export const CatalogFacets = z.object({
  labels: z.array(FacetCount), // most common first
  countries: z.array(FacetCount), // most common first
  years: z.array(z.object({ year: z.number().int(), count: z.number().int() })), // ascending
  /** Entries with no year / country / label (can't be matched by those filters). */
  missing: z.object({ year: z.number().int(), country: z.number().int(), label: z.number().int() }),
});
export type CatalogFacets = z.infer<typeof CatalogFacets>;

// --- Trash ---
/** What a trash item is: an approved catalog entry, or an unidentified capture. */
export const TrashKind = z.enum(["entry", "capture"]);
export type TrashKind = z.infer<typeof TrashKind>;

export const TrashItem = z.object({
  kind: TrashKind,
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string(),
  /** Cover art or the owner's photo; server-relative photo URLs need auth. */
  imageUrl: z.string().nullable(),
  deletedAt: z.string(), // ISO
  /** When the purge job will permanently delete it. */
  purgeAt: z.string(), // ISO
});
export type TrashItem = z.infer<typeof TrashItem>;

export const TrashList = z.object({
  items: z.array(TrashItem),
  retentionDays: z.number().int(),
});
export type TrashList = z.infer<typeof TrashList>;
