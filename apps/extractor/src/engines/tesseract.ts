import type { ExtractedRelease } from "@sonic/shared";
import type { ExtractionEngine, ExtractionResult, PhotoInput } from "./types.js";

/**
 * Classic OCR (tesseract.js): fully offline, no AI. It only transcribes text;
 * fields are left for the review/matching stage, except a barcode, which is
 * easy to spot reliably in raw text. Weak on artistic cover typography.
 * Note: tesseract.js downloads its English model on first use.
 */
export class TesseractEngine implements ExtractionEngine {
  readonly name = "tesseract" as const;
  readonly model = "eng";

  async extract(photos: PhotoInput[]): Promise<ExtractionResult> {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const sections: string[] = [];
      for (const [i, p] of photos.entries()) {
        const { data } = await worker.recognize(p.data);
        sections.push(`[Photo ${i + 1}: ${p.label}]\n${data.text.trim()}`);
      }
      const rawText = sections.join("\n\n");
      return { fields: { ...emptyFields(), barcode: findBarcode(rawText) }, rawText };
    } finally {
      await worker.terminate();
    }
  }
}

function emptyFields(): ExtractedRelease {
  return {
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
}

/** A 12–13 digit run (UPC-A / EAN-13), allowing the usual spaces between groups. */
export function findBarcode(text: string): string | null {
  for (const m of text.matchAll(/\b\d[\d ]{10,16}\d\b/g)) {
    const digits = m[0].replace(/ /g, "");
    if (digits.length === 12 || digits.length === 13) return digits;
  }
  return null;
}
