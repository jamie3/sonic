/**
 * Matcher: the matching stage (`recognize` jobs — search Discogs with
 * what the extractor read, quality-check candidates, hand to the owner for
 * approval) and the daily trash purge. Photo reading lives in apps/extractor.
 */
import { db } from "@sonic/core/db";
import {
  enqueueExtract,
  enqueueRecognize,
  getBoss,
  RECOGNIZE_QUEUE,
  type RecognizeJob,
  TRASH_PURGE_CRON,
  TRASH_PURGE_QUEUE,
  withoutOutstandingJob,
} from "@sonic/core/queue";
import { resolveMetadataSource } from "@sonic/core/metadata";
import { createServices } from "@sonic/core/services";
import { storage } from "@sonic/core/storage";

const SWEEP_INTERVAL_MS = 5 * 60_000;

export async function startMatcher() {
  // Local data-dump copy if imported, else the API with a token, else off.
  const metadata = await resolveMetadataSource();
  const services = createServices({
    db,
    storage,
    queue: { enqueueExtract, enqueueRecognize },
    metadata: metadata.source,
    metadataFallback: metadata.fallback,
  });
  const boss = await getBoss();

  if (!metadata.source) {
    console.warn(
      `matcher: no Discogs source (${metadata.description}) — captures skip matching and go straight to ` +
        "'ready to approve' with the AI's reading.",
    );
  }

  await boss.work<RecognizeJob>(
    RECOGNIZE_QUEUE,
    { batchSize: 1, includeMetadata: true }, // serial — stays under Discogs rate limits
    async ([job]) => {
      if (!job) return;
      const { captureId } = job.data;
      try {
        const status = await services.matching.handle(captureId);
        console.log(`matcher: capture ${captureId} → ${status}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const final = job.retryCount >= job.retryLimit;
        console.error(
          `matcher: matching ${captureId} failed (attempt ${job.retryCount + 1}/${job.retryLimit + 1})` +
            `${final ? " — giving up, ready to approve manually" : " — will retry"}: ${message}`,
        );
        if (final) await services.matching.giveUp(captureId, message);
        throw err;
      }
    },
  );

  // Captures in "review" whose matching job was lost (extracted before this
  // stage existed, or while the queue was down). On start, then periodically.
  const sweep = async () => {
    const lost = await withoutOutstandingJob(RECOGNIZE_QUEUE, await services.matching.findAwaitingMatch());
    for (const id of lost) await enqueueRecognize({ captureId: id });
    if (lost.length) console.log(`matcher: queued matching for ${lost.length} capture(s) in review`);
  };
  await sweep();
  setInterval(() => sweep().catch((err) => console.error("matcher: sweep failed", err)), SWEEP_INTERVAL_MS);

  // Trash: permanently delete items older than the retention period, daily.
  // The schedule lives in pg-boss's tables, so it survives restarts and runs
  // once even with several matchers running.
  await boss.work(TRASH_PURGE_QUEUE, async () => {
    const r = await services.trash.purgeExpired();
    console.log(`matcher: trash purge removed ${r.entries} entr${r.entries === 1 ? "y" : "ies"}, ${r.captures} capture(s)`);
  });
  await boss.schedule(TRASH_PURGE_QUEUE, TRASH_PURGE_CRON, undefined, { tz: "UTC" });
  // Catch up now too, in case the matcher was down at the scheduled time.
  await boss.send(TRASH_PURGE_QUEUE, {});

  console.log(
    `matcher: matching via ${metadata.description}; ` +
      `trash purge scheduled "${TRASH_PURGE_CRON}" UTC (retention ${services.trash.retentionDays} days)`,
  );
}
