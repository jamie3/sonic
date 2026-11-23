import { ExtractedRelease } from "@sonic/shared";
import { z } from "zod";

export interface PhotoInput {
  /** Which shot this is, e.g. "front cover", "label side A". */
  label: string;
  data: Buffer;
  mediaType: "image/jpeg";
}

export interface ExtractionResult {
  fields: ExtractedRelease;
  /** All legible text, verbatim, grouped by photo. */
  rawText: string;
}

/** A way of turning record photos into text + fields. Pluggable via EXTRACTOR_ENGINE. */
export interface ExtractionEngine {
  readonly name: "claude" | "ollama" | "tesseract";
  readonly model: string | null;
  extract(photos: PhotoInput[]): Promise<ExtractionResult>;
}

/** What the vision engines must return; validated before anything is stored. */
export const VisionOutput = ExtractedRelease.extend({ rawText: z.string() });

/**
 * JSON Schema for VisionOutput, in the strict form structured outputs need:
 * every property required, nullable via type unions, no extra properties.
 */
const nullableString = { type: ["string", "null"] };
export const VISION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "artist",
    "title",
    "label",
    "catalogNumber",
    "barcode",
    "year",
    "country",
    "format",
    "tracklist",
    "rawText",
  ],
  properties: {
    artist: { ...nullableString, description: "Performing artist as printed" },
    title: { ...nullableString, description: "Release title as printed" },
    label: { ...nullableString, description: "Record label / company" },
    catalogNumber: { ...nullableString, description: "Catalog number, e.g. 'SHVL 804'" },
    barcode: { ...nullableString, description: "Barcode digits only (UPC/EAN)" },
    year: { type: ["integer", "null"], description: "Release / ℗ / © year printed on the item" },
    country: { ...nullableString, description: "Country of manufacture if printed" },
    format: { ...nullableString, description: "e.g. LP, 7\", 12\", 2×LP, CD" },
    tracklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["position", "title"],
        properties: {
          position: { ...nullableString, description: "e.g. A1, B2, 3" },
          title: { type: "string" },
        },
      },
    },
    rawText: {
      type: "string",
      description: "Every legible piece of text, verbatim, grouped as '[Photo N: <shot>]' sections",
    },
  },
} as const;

export const SYSTEM_PROMPT = `You transcribe photographs of a physical music release — a vinyl record (sleeve front/back, labels) or a CD (booklet, case, disc) — for a cataloguing system.

Report only what is actually printed or legible in the photos. Do not fill gaps from your own knowledge of the release: a later stage matches the release against online databases, and it needs to know exactly what the item itself says. If a field isn't legible, use null. Keep original spelling, capitalisation and punctuation. For the barcode, give digits only. For rawText, transcribe all legible text — including small print, credits and matrix/rights text — grouped per photo.`;

export function userPrompt(photos: PhotoInput[]): string {
  const list = photos.map((p, i) => `Photo ${i + 1}: ${p.label}`).join("\n");
  return `The photos, in order:\n${list}\n\nExtract the fields and transcribe the text.`;
}

/** Validate an engine's JSON reply; throws with the zod issues if it doesn't match. */
export function parseVisionOutput(json: string): ExtractionResult {
  const parsed = VisionOutput.parse(JSON.parse(json));
  const { rawText, ...fields } = parsed;
  return { fields, rawText };
}
