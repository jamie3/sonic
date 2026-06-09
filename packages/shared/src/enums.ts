import { z } from "zod";

/** Lifecycle of a capture, from upload through owner approval. */
export const CaptureStatus = z.enum([
  "processing", // recognition job running
  "pending_single", // exactly one match — confirm/bulk-approve
  "pending_multiple", // many matches — owner disambiguates
  "pending_nomatch", // no match — owner resolves manually
  "approved", // promoted into the catalog
  "skipped", // owner discarded
]);
export type CaptureStatus = z.infer<typeof CaptureStatus>;

/** Which photo of the record this is. */
export const PhotoType = z.enum(["front", "back", "label_a", "label_b", "spine"]);
export type PhotoType = z.infer<typeof PhotoType>;

/** How a candidate was identified. */
export const MatchMethod = z.enum(["barcode", "ocr", "vision", "manual"]);
export type MatchMethod = z.infer<typeof MatchMethod>;

/** Goldmine media condition grades (vinyl standard). */
export const Condition = z.enum(["M", "NM", "VG+", "VG", "G+", "G", "F", "P"]);
export type Condition = z.infer<typeof Condition>;

/** External metadata sources. */
export const MetadataSourceName = z.enum(["discogs", "musicbrainz"]);
export type MetadataSourceName = z.infer<typeof MetadataSourceName>;
