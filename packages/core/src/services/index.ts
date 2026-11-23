/**
 * Service factory: wires repositories → services. The HTTP server exposes the
 * result on the Fastify instance (plugins/services.ts → `app.services`); the
 * matcher uses it directly. Every dependency can be swapped for a fake in tests.
 */
import type { Kysely } from "kysely";
import { config } from "../config.js";
import type { Database } from "../db/types.js";
import { type ImageProcessor, SharpImageProcessor } from "../images/processor.js";
import {
  createRepositories,
  KyselyTransactionRunner,
  type Repositories,
  type TransactionRunner,
} from "../repositories/index.js";
import type { ImageStorage } from "../storage/index.js";
import { CaptureService, type JobQueue } from "./capture.service.js";
import { CatalogService } from "./catalog.service.js";
import { ImageService } from "./image.service.js";
import { discogs, type MetadataSource } from "../metadata/index.js";
import { MatchingService } from "./matching.service.js";
import { ReleaseDetailsService } from "./release-details.service.js";
import { TrashService } from "./trash.service.js";

export interface ServiceDeps {
  db: Kysely<Database>;
  storage: ImageStorage;
  queue: JobQueue;
  /** Metadata source for matching; null disables it. Defaults to Discogs when DISCOGS_TOKEN is set. */
  metadata?: MetadataSource | null;
  /** Searched when `metadata` finds nothing (the Discogs API behind the local copy). */
  metadataFallback?: MetadataSource | null;
  images?: ImageProcessor;
  trashRetentionDays?: number;
  /** Test seams: replace the DB-backed repositories / transaction runner. */
  repos?: Repositories;
  tx?: TransactionRunner;
}

export function createServices(deps: ServiceDeps) {
  const repos = deps.repos ?? createRepositories(deps.db);
  const tx = deps.tx ?? new KyselyTransactionRunner(deps.db);

  const catalog = new CatalogService(repos, tx, (key) => deps.storage.url(key));
  const metadata = deps.metadata !== undefined ? deps.metadata : config.DISCOGS_TOKEN ? discogs : null;
  const releaseDetails = new ReleaseDetailsService(repos, [metadata, deps.metadataFallback]);
  return {
    catalog,
    captures: new CaptureService(
      repos,
      tx,
      deps.storage,
      deps.queue,
      catalog,
      deps.images ?? new SharpImageProcessor(),
      releaseDetails,
    ),
    releaseDetails,
    images: new ImageService(deps.storage, repos),
    matching: new MatchingService(
      repos,
      tx,
      metadata,
      deps.metadataFallback ?? null,
    ),
    trash: new TrashService(
      repos,
      tx,
      deps.storage,
      (key) => deps.storage.url(key),
      deps.trashRetentionDays ?? config.TRASH_RETENTION_DAYS,
    ),
  };
}

export type Services = ReturnType<typeof createServices>;
