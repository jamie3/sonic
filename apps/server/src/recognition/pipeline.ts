/**
 * Recognition cascade (architecture.md §6). Barcode → OCR → vision LLM, then
 * resolve against the metadata sources. Outcome is purely match-count: no score.
 */
import type { MatchMethod, ReleaseMatch } from "@sonic/shared";
import { discogs } from "../metadata/index.js";
import { storage } from "../storage/index.js";
import { vision, type ExtractedFields } from "../vision/index.js";

export interface RecognitionInput {
  captureId: string;
  barcodeHint: string | null;
  photos: { type: string; storageKey: string }[];
}

export interface RecognitionResult {
  method: MatchMethod;
  matches: ReleaseMatch[];
  extracted?: ExtractedFields;
}

export async function runRecognition(input: RecognitionInput): Promise<RecognitionResult> {
  // 1. Barcode — strongest signal (on-device hint, else decode from photo).
  const barcode = input.barcodeHint ?? (await decodeBarcodeFromPhotos(input));
  if (barcode) {
    const matches = await discogs.searchByBarcode(barcode);
    if (matches.length) return { method: "barcode", matches };
  }

  // 2. OCR — catalog number is very distinctive for vinyl.
  const ocr = await ocrLabel(input);
  if (ocr.catalogNumber) {
    const matches = await discogs.searchByCatalogNumber(ocr.catalogNumber);
    if (matches.length) return { method: "ocr", matches, extracted: ocr };
  }

  // 3. Vision LLM — fallback for messy/obscured photos.
  const fields = await extractWithVision(input);
  const merged = { ...ocr, ...fields };

  // Nothing usable extracted — declare no-match rather than searching on empty.
  if (!merged.artist && !merged.title && !merged.catalogNumber && !merged.label) {
    return { method: "vision", matches: [], extracted: merged };
  }
  const matches = await discogs.searchByText(merged);
  return { method: "vision", matches, extracted: merged };
}

// --- stage helpers (stubs to be filled in) ---

async function decodeBarcodeFromPhotos(_input: RecognitionInput): Promise<string | null> {
  // TODO: server-side barcode decode (e.g. @zxing/library) over label/back photos.
  return null;
}

async function ocrLabel(_input: RecognitionInput): Promise<ExtractedFields> {
  // TODO: run tesseract over the label/back photos; parse catalog number + label.
  return {};
}

async function extractWithVision(input: RecognitionInput): Promise<ExtractedFields> {
  const buffers = await Promise.all(
    input.photos.slice(0, 3).map(async (p) => {
      const stream = await storage.getStream(p.storageKey);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      return { data: Buffer.concat(chunks), mediaType: "image/jpeg" as const };
    }),
  );
  return vision.extract(buffers);
}
