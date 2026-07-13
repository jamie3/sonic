import { z } from "zod";
import { CaptureStatus, Condition, MatchMethod, PhotoType } from "./enums.js";
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

// --- Captures ---
export const CapturePhoto = z.object({
  id: z.string().uuid(),
  type: PhotoType,
  url: z.string(),
});
export type CapturePhoto = z.infer<typeof CapturePhoto>;

export const IdentificationCandidate = z.object({
  id: z.string().uuid(),
  method: MatchMethod,
  rank: z.number().int(),
  release: ReleaseMatch,
});
export type IdentificationCandidate = z.infer<typeof IdentificationCandidate>;

export const Capture = z.object({
  id: z.string().uuid(),
  status: CaptureStatus,
  barcodeHint: z.string().nullable(),
  photos: z.array(CapturePhoto),
  candidates: z.array(IdentificationCandidate),
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

/** Resolve a no-match capture by supplying metadata directly. */
export const ResolveRequest = z.object({
  // pick an existing source release ...
  source: ReleaseMatch.optional(),
  // ... or hand-enter the metadata
  manual: ReleaseDetail.partial().optional(),
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
  photos: z.array(CapturePhoto),
  approvedAt: z.string(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

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
    genres: z.array(z.string()),
    styles: z.array(z.string()),
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
    release: UpdateRelease,
  })
  .partial();
export type UpdateCatalogEntry = z.infer<typeof UpdateCatalogEntry>;

export const CatalogSearchQuery = z.object({
  q: z.string().optional(),
  artist: z.string().optional(),
  label: z.string().optional(),
  year: z.coerce.number().int().optional(),
  genre: z.string().optional(),
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
