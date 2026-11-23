/** pg-boss queue — durable background jobs inside Postgres (architecture.md §4.3). */
import { sql } from "kysely";
import PgBoss from "pg-boss";
import { config } from "./config.js";
import { db } from "./db/index.js";

/** New captures → the extractor app (photos → text/fields → status "review"). */
export const EXTRACT_QUEUE = "extract";
/** Matching stage: "review" captures → search Discogs → pending_* for approval. */
export const RECOGNIZE_QUEUE = "recognize";
/** Daily trash purge, scheduled by the matcher (pg-boss cron, stored in Postgres). */
export const TRASH_PURGE_QUEUE = "trash-purge";
export const TRASH_PURGE_CRON = "15 3 * * *"; // 03:15 every day
/** Attempts after the first; on the last failure the capture is marked unidentified. */
export const RECOGNIZE_RETRY_LIMIT = 3;

export interface RecognizeJob {
  captureId: string;
}

export interface ExtractJob {
  captureId: string;
}

/** Retries after the first attempt; on the last failure the capture goes to review with the error. */
export const EXTRACT_RETRY_LIMIT = 3;

let boss: Promise<PgBoss> | null = null;

/**
 * Started pg-boss instance with our queues created. pg-boss v10 drops jobs
 * sent to a queue that doesn't exist, so the queue must be created up front
 * (idempotent: create_queue is ON CONFLICT DO NOTHING).
 */
export function getBoss(): Promise<PgBoss> {
  boss ??= startBoss().catch((err) => {
    boss = null; // let the next call retry
    throw err;
  });
  return boss;
}

/**
 * The API, matcher and extractor all start pg-boss. On a fresh database their
 * concurrent schema install / create_queue calls can deadlock (40P01) or race
 * on a unique key (23505); both are safe to retry once the other process wins.
 */
const TRANSIENT_START_ERRORS = new Set(["40P01", "23505"]);

async function startBoss(attempt = 1): Promise<PgBoss> {
  const b = new PgBoss(config.DATABASE_URL);
  b.on("error", (err) => console.error("pg-boss error", err));
  try {
    await b.start();
    await b.createQueue(EXTRACT_QUEUE);
    await b.createQueue(RECOGNIZE_QUEUE);
    await b.createQueue(TRASH_PURGE_QUEUE);
    return b;
  } catch (err) {
    await b.stop({ graceful: false }).catch(() => {});
    const code = (err as { code?: string }).code;
    if (attempt >= 5 || !code || !TRANSIENT_START_ERRORS.has(code)) throw err;
    await new Promise((r) => setTimeout(r, 200 * attempt + Math.random() * 300));
    return startBoss(attempt + 1);
  }
}

export async function enqueueExtract(job: ExtractJob): Promise<void> {
  const b = await getBoss();
  const id = await b.send(EXTRACT_QUEUE, job, {
    retryLimit: EXTRACT_RETRY_LIMIT,
    retryBackoff: true,
  });
  if (!id) throw new Error(`failed to enqueue extract job for capture ${job.captureId}`);
}

export async function enqueueRecognize(job: RecognizeJob): Promise<void> {
  const b = await getBoss();
  const id = await b.send(RECOGNIZE_QUEUE, job, {
    retryLimit: RECOGNIZE_RETRY_LIMIT,
    retryBackoff: true,
  });
  // Never drop a job silently: a null id means pg-boss didn't store it.
  if (!id) throw new Error(`failed to enqueue recognize job for capture ${job.captureId}`);
}

/**
 * Of the given capture ids, those with no job on `queue` still waiting,
 * retrying or running — i.e. whose job was lost. Lets a startup sweep re-queue
 * only what needs it, so no capture is processed (and billed) twice.
 */
export async function withoutOutstandingJob(queue: string, captureIds: string[]): Promise<string[]> {
  if (captureIds.length === 0) return [];
  const { rows } = await sql<{ id: string }>`
    select (j.data->>'captureId') as id
    from pgboss.job j
    where j.name = ${queue}
      and j.state in ('created', 'retry', 'active')
      and (j.data->>'captureId') in (${sql.join(captureIds)})
  `.execute(db);
  const queued = new Set(rows.map((r) => r.id));
  return captureIds.filter((id) => !queued.has(id));
}
