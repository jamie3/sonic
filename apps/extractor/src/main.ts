/**
 * Sonic extractor — a separate background app.
 *
 * Consumes `extract` jobs (one per uploaded capture): reads the capture's
 * photos with the configured engine (Claude vision by default; Ollama or
 * Tesseract via EXTRACTOR_ENGINE), stores the extracted text + fields in
 * `capture_extraction`, and moves the capture from "processing" to "review".
 * Matching against Discogs is a later stage that starts from "review".
 */
import { config } from "./config.js";
import { db } from "@sonic/core/db";
import {
  enqueueExtract,
  enqueueRecognize,
  EXTRACT_QUEUE,
  type ExtractJob,
  getBoss,
  withoutOutstandingJob,
} from "@sonic/core/queue";
import { createRepositories, KyselyTransactionRunner } from "@sonic/core/repositories";
import { storage } from "@sonic/core/storage";
import { createEngine } from "./engines/index.js";
import { type ExtractDeps, extractCapture, recordFailure } from "./extract.js";

const SWEEP_INTERVAL_MS = 5 * 60_000;

async function main() {
  const deps: ExtractDeps = {
    repos: createRepositories(db),
    tx: new KyselyTransactionRunner(db),
    storage,
    engine: createEngine(),
    enqueueMatch: (captureId) => enqueueRecognize({ captureId }),
  };
  const boss = await getBoss();

  // pg-boss v10 has no local-concurrency option: register one worker per slot.
  for (let i = 0; i < config.concurrency; i++) {
    await boss.work<ExtractJob>(EXTRACT_QUEUE, { batchSize: 1, includeMetadata: true }, async ([job]) => {
      if (!job) return;
      const { captureId } = job.data;
      const started = Date.now();
      try {
        const outcome = await extractCapture(captureId, deps);
        log(`capture ${captureId} → ${outcome} (${Date.now() - started} ms)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const final = job.retryCount >= job.retryLimit;
        log(
          `capture ${captureId} failed (attempt ${job.retryCount + 1}/${job.retryLimit + 1})` +
            `${final ? " — giving up, sending to review with the error" : " — will retry"}: ${message}`,
        );
        if (final) await recordFailure(captureId, message, deps);
        throw err;
      }
    });
  }

  // Recover captures whose job was lost — uploaded before this app existed,
  // while the queue was down, or restored from the trash after their job was
  // skipped. Ones with a job still queued are left alone. On start, then every
  // few minutes.
  const sweep = async () => {
    const processing = await deps.repos.captures.listByStatus(["processing"], null); // every user's
    const lost = await withoutOutstandingJob(
      EXTRACT_QUEUE,
      processing.map((c) => c.id),
    );
    for (const id of lost) await enqueueExtract({ captureId: id });
    if (lost.length) log(`re-queued ${lost.length} capture(s) still processing`);
  };
  await sweep();
  const sweeper = setInterval(() => sweep().catch((err) => log(`sweep failed: ${err}`)), SWEEP_INTERVAL_MS);

  log(
    `listening for extract jobs — engine ${deps.engine.name}` +
      `${deps.engine.model ? ` (${deps.engine.model})` : ""}, concurrency ${config.concurrency}`,
  );

  const shutdown = async (signal: string) => {
    log(`${signal} received, finishing in-flight jobs…`);
    clearInterval(sweeper);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.destroy();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

function log(msg: string) {
  console.log(`extractor: ${msg}`);
}

main().catch((err) => {
  console.error("extractor failed to start:", err);
  process.exit(1);
});
