/** pg-boss queue — durable background jobs inside Postgres (architecture.md §4.3). */
import PgBoss from "pg-boss";
import { config } from "./config.js";

export const RECOGNIZE_QUEUE = "recognize";

export interface RecognizeJob {
  captureId: string;
}

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss(config.DATABASE_URL);
  await boss.start();
  return boss;
}

export async function enqueueRecognize(job: RecognizeJob): Promise<void> {
  const b = await getBoss();
  await b.send(RECOGNIZE_QUEUE, job, { retryLimit: 3, retryBackoff: true });
}
