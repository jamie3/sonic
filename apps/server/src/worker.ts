/** Recognition worker — consumes `recognize` jobs and writes candidates. */
import type { CaptureStatus } from "@sonic/shared";
import { db } from "./db/index.js";
import { getBoss, RECOGNIZE_QUEUE, type RecognizeJob } from "./queue.js";
import { runRecognition } from "./recognition/pipeline.js";
import { upsertRelease } from "./services/releases.js";

export async function work() {
  const boss = await getBoss();
  await boss.work<RecognizeJob>(
    RECOGNIZE_QUEUE,
    { batchSize: 1 }, // serial — stays under Discogs rate limits
    async ([job]) => {
      if (!job) return;
      await handleRecognize(job.data);
    },
  );
  console.log("worker: listening for recognize jobs");
}

async function handleRecognize(job: RecognizeJob): Promise<void> {
  const photos = await db
    .selectFrom("capture_photo")
    .select(["type", "storage_key as storageKey"])
    .where("capture_id", "=", job.captureId)
    .execute();

  const cap = await db
    .selectFrom("capture")
    .select("barcode_hint")
    .where("id", "=", job.captureId)
    .executeTakeFirstOrThrow();

  const result = await runRecognition({
    captureId: job.captureId,
    barcodeHint: cap.barcode_hint,
    photos,
  });

  // Cache matched releases + record candidates.
  await db.deleteFrom("identification_candidate").where("capture_id", "=", job.captureId).execute();
  let rank = 1;
  for (const match of result.matches) {
    const releaseId = await upsertRelease(match);
    await db
      .insertInto("identification_candidate")
      .values({
        capture_id: job.captureId,
        release_id: releaseId,
        method: result.method,
        rank: rank++,
        extracted: result.extracted ? JSON.stringify(result.extracted) : null,
      })
      .execute();
  }

  // Outcome is match-count only — no scoring (architecture.md §6.3).
  const status: CaptureStatus =
    result.matches.length === 0
      ? "pending_nomatch"
      : result.matches.length === 1
        ? "pending_single"
        : "pending_multiple";

  await db.updateTable("capture").set({ status }).where("id", "=", job.captureId).execute();
}
