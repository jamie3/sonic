/** Maps capture rows to the @sonic/shared `Capture` DTO. */
import type {
  Capture,
  CaptureExtraction,
  CaptureMatch,
  CapturePhoto,
  ExtractedRelease,
  FieldAgreement,
} from "@sonic/shared";
import type {
  CandidateWithRelease,
  CaptureExtractionRow,
  CaptureMatchRow,
  CapturePhotoRow,
  CaptureRow,
} from "../repositories/capture.repository.js";
import { toReleaseMatch } from "./release.mapper.js";

/** Resolves a storage key to a client-loadable URL. */
export type PhotoUrlFn = (storageKey: string) => string;

export function toPhotoDto(p: CapturePhotoRow, photoUrl: PhotoUrlFn): CapturePhoto {
  return { id: p.id, type: p.type, url: photoUrl(p.storage_key) };
}

const EMPTY_FIELDS: ExtractedRelease = {
  artist: null,
  title: null,
  label: null,
  catalogNumber: null,
  barcode: null,
  year: null,
  country: null,
  format: null,
  tracklist: [],
};

export function toExtractionDto(row: CaptureExtractionRow): CaptureExtraction {
  return {
    engine: row.engine,
    model: row.model,
    // Defensive merge: rows written by older extractor versions may lack fields.
    fields: { ...EMPTY_FIELDS, ...((row.fields as Partial<ExtractedRelease> | null) ?? {}) },
    rawText: row.raw_text,
    error: row.error,
    extractedAt: new Date(row.extracted_at).toISOString(),
  };
}

export function toMatchDto(row: CaptureMatchRow): CaptureMatch {
  return {
    source: row.source,
    outcome: row.outcome,
    message: row.message,
    queries: Array.isArray(row.queries) ? (row.queries as string[]) : [],
    matchedAt: new Date(row.matched_at).toISOString(),
  };
}

export function toCaptureDto(
  cap: CaptureRow,
  photos: CapturePhotoRow[],
  candidates: CandidateWithRelease[],
  photoUrl: PhotoUrlFn,
  extraction?: CaptureExtractionRow,
  match?: CaptureMatchRow,
): Capture {
  return {
    id: cap.id,
    status: cap.status,
    media: cap.media,
    barcodeHint: cap.barcode_hint,
    createdAt: new Date(cap.created_at).toISOString(),
    photos: photos.map((p) => toPhotoDto(p, photoUrl)),
    candidates: candidates.map((c) => ({
      id: c.cid,
      method: c.method,
      rank: c.rank,
      release: toReleaseMatch(c),
      score: c.score,
      agreement: Array.isArray(c.agreement) ? (c.agreement as FieldAgreement[]) : [],
    })),
    extraction: extraction ? toExtractionDto(extraction) : null,
    match: match ? toMatchDto(match) : null,
  };
}
