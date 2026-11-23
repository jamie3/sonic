import type { Readable } from "node:stream";
import type { ExtractedRelease, PhotoType } from "@sonic/shared";
import type { Repositories, TransactionRunner } from "@sonic/core/repositories";
import type { ImageStorage } from "@sonic/core/storage";
import type { ExtractionEngine, PhotoInput } from "./engines/index.js";

/** Shot order sent to the engine, and how each shot is described to it. */
const SHOT_ORDER: PhotoType[] = ["front", "back", "label_a", "label_b", "spine"];
const SHOT_LABEL: Record<PhotoType, string> = {
  front: "front cover",
  back: "back cover",
  label_a: "label, side A (or CD disc face)",
  label_b: "label, side B",
  spine: "spine",
};

export interface ExtractDeps {
  repos: Repositories;
  tx: TransactionRunner;
  storage: ImageStorage;
  engine: ExtractionEngine;
  /** Hand the capture to the next stage (Discogs matching, in apps/matcher). */
  enqueueMatch: (captureId: string) => Promise<void>;
}

export type ExtractOutcome = "review" | "skipped";

/**
 * Read one capture's photos and store what the engine found, moving the
 * capture from "processing" to "review" in the same transaction, then queue
 * the Discogs matching stage. Captures that
 * are no longer processing (already extracted, resolved, or trashed) are skipped,
 * so duplicate or re-queued jobs are harmless.
 */
export async function extractCapture(captureId: string, deps: ExtractDeps): Promise<ExtractOutcome> {
  const cap = await deps.repos.captures.findByIdIncludingTrashed(captureId, null); // background job: any owner
  if (!cap || cap.deleted_at || cap.status !== "processing") return "skipped";

  const photos = (await deps.repos.captures.findPhotos(captureId)).sort(
    (a, b) => SHOT_ORDER.indexOf(a.type) - SHOT_ORDER.indexOf(b.type),
  );
  if (photos.length === 0) throw new Error("capture has no photos");

  const inputs: PhotoInput[] = [];
  for (const p of photos) {
    inputs.push({
      label: SHOT_LABEL[p.type],
      data: await readAll(await deps.storage.getStream(p.storage_key)),
      mediaType: "image/jpeg", // the API stores every photo as JPEG
    });
  }

  const started = Date.now();
  const result = await deps.engine.extract(inputs);
  // Fill the barcode from the phone's scan when the engine couldn't read one.
  const fields = { ...result.fields, barcode: result.fields.barcode ?? cap.barcode_hint };

  const moved = await deps.tx.run(async (repos) => {
    // Re-check inside the transaction: the owner may have trashed it meanwhile.
    const current = await repos.captures.findById(captureId, null);
    if (!current || current.status !== "processing") return false;
    await repos.captures.saveExtraction({
      captureId,
      engine: deps.engine.name,
      model: deps.engine.model,
      fields,
      rawText: result.rawText,
      error: null,
      durationMs: Date.now() - started,
    });
    await repos.captures.setStatus(captureId, "review");
    return true;
  });
  if (moved) await deps.enqueueMatch(captureId);
  return moved ? "review" : "skipped";
}

/**
 * Out of retries: record the failure and still move the capture to "review",
 * so it surfaces for the owner instead of sitting in "processing" forever.
 */
export async function recordFailure(captureId: string, error: string, deps: ExtractDeps): Promise<void> {
  const moved = await deps.tx.run(async (repos) => {
    const current = await repos.captures.findById(captureId, null);
    if (!current || current.status !== "processing") return false;
    await repos.captures.saveExtraction({
      captureId,
      engine: deps.engine.name,
      model: deps.engine.model,
      fields: { ...EMPTY_FIELDS, barcode: current.barcode_hint },
      rawText: "",
      error,
      durationMs: null,
    });
    await repos.captures.setStatus(captureId, "review");
    return true;
  });
  // Still try matching (e.g. on the phone's barcode scan); it ends at "ready to approve".
  if (moved) await deps.enqueueMatch(captureId);
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

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
