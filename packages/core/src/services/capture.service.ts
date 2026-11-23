import { randomUUID } from "node:crypto";
import type {
  ApproveRequest,
  ResolveRequest,
  BulkApproveResult,
  BulkRematchResult,
  Capture,
  CaptureStatus,
  CatalogEntry,
  MediaKind,
  PhotoType,
} from "@sonic/shared";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import { toCaptureDto } from "../mappers/capture.mapper.js";
import type { ExtractJob, RecognizeJob } from "../queue.js";
import type { Repositories, TransactionRunner } from "../repositories/index.js";
import type { ImageStorage } from "../storage/index.js";
import type { ImageProcessor, ProcessedImage } from "../images/processor.js";
import type { Owner } from "../repositories/owner.js";
import type { CatalogService } from "./catalog.service.js";
import type { ReleaseDetailsService } from "./release-details.service.js";
import { normalizeTags } from "./tags.js";

/** Statuses awaiting the owner's decision in the review queue. */
export const PENDING_STATUSES: CaptureStatus[] = [
  "pending_single",
  "pending_multiple",
  "pending_nomatch",
];

/** Shown in the review queue: extracted-and-awaiting-review, plus match decisions. */
export const REVIEW_QUEUE_STATUSES: CaptureStatus[] = ["review", ...PENDING_STATUSES];

/** Not yet in the catalog: being read, read-and-awaiting-review, or awaiting a match decision. */
export const UNIDENTIFIED_STATUSES: CaptureStatus[] = ["processing", ...REVIEW_QUEUE_STATUSES];

export interface JobQueue {
  /** Hand a new capture to the extractor app (photos → text/fields → "review"). */
  enqueueExtract(job: ExtractJob): Promise<void>;
  /** Hand an extracted capture to the matcher app (search Discogs → candidates). */
  enqueueRecognize(job: RecognizeJob): Promise<void>;
}

/** Capture intake, the review queue, and promotion into the catalog. */
export class CaptureService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly storage: ImageStorage,
    private readonly queue: JobQueue,
    private readonly catalog: CatalogService,
    private readonly images: ImageProcessor,
    /** Fills in an approved release's tracklist etc. when the match carried none. */
    private readonly releaseDetails?: ReleaseDetailsService,
  ) {}

  /**
   * Create a capture from uploaded photos, then enqueue recognition.
   *
   * - Every photo is normalized to the storage format (images/processor.ts)
   *   before anything is written, so a bad file fails without side effects.
   * - Images are written first, then the capture + photo rows in one
   *   transaction, then the job is enqueued — so the extractor never sees a
   *   capture whose images aren't stored, and a failure leaves nothing behind.
   * - Idempotent on `captureId`: offline clients pick the id and resend after
   *   a lost response; a repeat returns the existing capture (`created: false`).
   */
  async create(userId: string, input: {
    photos: Map<PhotoType, Buffer>;
    media: MediaKind | null;
    barcodeHint: string | null;
    captureId?: string;
  }): Promise<{ capture: Capture; created: boolean }> {
    if (input.captureId && (await this.repos.captures.findByIdIncludingTrashed(input.captureId, null))) {
      // A retry of an upload: return it — but only to its owner (ids are client-chosen).
      return { capture: await this.get(userId, input.captureId), created: false };
    }
    if (input.photos.size === 0) throw new BadRequestError("no photos");

    const processed = new Map<PhotoType, ProcessedImage>();
    for (const [type, buffer] of input.photos) {
      processed.set(type, await this.images.normalize(buffer));
    }

    const captureId = input.captureId ?? randomUUID();
    // Per-attempt suffix: a racing duplicate request never overwrites (or, on
    // rollback, deletes) the files of the request that won.
    const attempt = randomUUID().slice(0, 8);
    const stored: { type: PhotoType; storageKey: string; width: number; height: number }[] = [];
    try {
      for (const [type, img] of processed) {
        const storageKey = `captures/${captureId}/${type}-${attempt}.${img.extension}`;
        await this.storage.put(storageKey, img.data, img.contentType);
        stored.push({ type, storageKey, width: img.width, height: img.height });
      }
      await this.tx.run((repos) =>
        repos.captures.createWithPhotos({
          id: captureId,
          userId,
          media: input.media,
          barcodeHint: input.barcodeHint,
          photos: stored,
        }),
      );
    } catch (err) {
      // Roll back any images already written so nothing is orphaned on disk.
      await Promise.allSettled(stored.map((p) => this.storage.delete(p.storageKey)));
      // Lost a race with a concurrent retry of the same capture: return theirs.
      if (input.captureId && isUniqueViolation(err)) {
        return { capture: await this.get(userId, captureId), created: false };
      }
      throw err;
    }

    await this.queue.enqueueExtract({ captureId });
    return { capture: await this.get(userId, captureId), created: true };
  }

  /**
   * The review queue (pending_*) by default; every capture with `status`; or,
   * with scope "unidentified", everything not yet in the catalog (incl. processing).
   */
  async list(owner: Owner, opts: { status?: CaptureStatus; scope?: "review" | "unidentified" } = {}): Promise<Capture[]> {
    const statuses = opts.status
      ? [opts.status]
      : opts.scope === "unidentified"
        ? UNIDENTIFIED_STATUSES
        : REVIEW_QUEUE_STATUSES;
    const rows = await this.repos.captures.listByStatus(statuses, owner);
    return Promise.all(rows.map((r) => this.get(owner, r.id)));
  }

  async get(owner: Owner, id: string): Promise<Capture> {
    const cap = await this.repos.captures.findById(id, owner);
    if (!cap) throw new NotFoundError();
    const [photos, candidates, extraction, match] = await Promise.all([
      this.repos.captures.findPhotos(id),
      this.repos.captures.findCandidates(id),
      this.repos.captures.findExtraction(id),
      this.repos.captures.findMatch(id),
    ]);
    return toCaptureDto(cap, photos, candidates, (key) => this.storage.url(key), extraction, match);
  }

  /**
   * Promote a pending capture into the catalog using the chosen candidate (or
   * the rank-1 candidate). The entry insert and status change are atomic.
   */
  async approve(owner: Owner, captureId: string, body: ApproveRequest): Promise<CatalogEntry> {
    const { entryId, releaseId } = await this.tx.run(async (repos) => {
      const cap = await repos.captures.findById(captureId, owner);
      if (!cap) throw new NotFoundError();
      if (!PENDING_STATUSES.includes(cap.status)) {
        throw new ConflictError(`capture is not pending (${cap.status})`);
      }

      const candidate = await repos.captures.findCandidate(captureId, body.candidateId);
      if (!candidate) {
        throw body.candidateId
          ? new BadRequestError("candidate not found for this capture")
          : new ConflictError("no candidate to approve; manual resolution required");
      }

      const copy = body.copy ?? {};
      const id = await repos.catalog.create({
        user_id: cap.user_id,
        capture_id: captureId,
        release_id: candidate.release_id,
        condition: copy.condition ?? null,
        location: copy.location ?? null,
        purchase_price: copy.purchasePrice ?? null,
        purchase_date: copy.purchaseDate ?? null,
        notes: copy.notes ?? null,
      });
      // Seed the entry's tags from the source's classifications (e.g. Discogs
      // genres + styles); the owner edits them freely afterwards.
      const suggested = await repos.releases.findSourceTags(candidate.release_id);
      await repos.tags.setForEntry(id, normalizeTags(suggested));
      await repos.captures.setStatus(captureId, "approved", new Date());
      return { entryId: id, releaseId: candidate.release_id };
    });
    // A match from a Discogs API search has no tracklist: fetch the full
    // release now. Best effort — approval already succeeded.
    if (this.releaseDetails) {
      await this.releaseDetails.fill(releaseId).catch((err) => {
        console.warn(`approve: couldn't fetch release details for ${releaseId}:`, err instanceof Error ? err.message : err);
      });
    }
    return this.catalog.get(owner, entryId);
  }

  /**
   * Approve with owner-confirmed data instead of a source match: for no-match
   * captures, or when none of the candidates is right. Creates a "manual"
   * release from the (usually AI-read, owner-corrected) fields.
   */
  async resolveManual(owner: Owner, captureId: string, body: ResolveRequest): Promise<CatalogEntry> {
    const m = body.manual;
    const entryId = await this.tx.run(async (repos) => {
      const cap = await repos.captures.findById(captureId, owner);
      if (!cap) throw new NotFoundError();
      if (!PENDING_STATUSES.includes(cap.status)) {
        throw new ConflictError(`capture is not ready to approve (${cap.status})`);
      }
      const releaseId = await repos.releases.upsert({
        source: "manual",
        sourceId: captureId, // one hand-confirmed release per capture
        artist: m.artist,
        title: m.title,
        label: m.label || undefined,
        catalogNumber: m.catalogNumber || undefined,
        barcode: m.barcode || undefined,
        year: m.year ?? undefined,
        country: m.country || undefined,
        format: m.format || undefined,
        tracklist: m.tracklist?.map((t) => ({ position: t.position ?? "", title: t.title })),
      });
      const copy = body.copy ?? {};
      const id = await repos.catalog.create({
        user_id: cap.user_id,
        capture_id: captureId,
        release_id: releaseId,
        condition: copy.condition ?? null,
        location: copy.location ?? null,
        purchase_price: copy.purchasePrice ?? null,
        purchase_date: copy.purchaseDate ?? null,
        notes: copy.notes ?? null,
      });
      await repos.captures.setStatus(captureId, "approved", new Date());
      return id;
    });
    return this.catalog.get(owner, entryId);
  }

  /**
   * Send a capture back to the extractor (e.g. it failed to read, after
   * switching engines, or after retaking photos). Any time before approval.
   */
  async reextract(owner: Owner, id: string): Promise<Capture> {
    const cap = await this.repos.captures.findById(id, owner);
    if (!cap) throw new NotFoundError();
    if (cap.status === "approved" || cap.status === "skipped") {
      throw new ConflictError(`can't re-read a capture in status ${cap.status}`);
    }
    await this.repos.captures.setStatus(id, "processing");
    await this.queue.enqueueExtract({ captureId: id });
    return this.get(owner, id);
  }

  /**
   * Ask the matcher to search Discogs again — e.g. after the Discogs data was
   * (re)imported or the matching rules changed. Uses what the extractor already
   * read (send it back to the extractor to re-read the photos instead). Only
   * for captures awaiting a match decision; one already being matched is left
   * as is. Old candidates are replaced when the new search finishes.
   */
  async rematch(owner: Owner, id: string): Promise<Capture> {
    const cap = await this.repos.captures.findById(id, owner);
    if (!cap) throw new NotFoundError();
    const reason = this.rematchBlocker(cap.status);
    if (reason) throw new ConflictError(reason);
    if (cap.status !== "review") {
      await this.repos.captures.setStatus(id, "review");
      // If this fails, the matcher's periodic sweep still picks it up (status is "review").
      await this.queue.enqueueRecognize({ captureId: id });
    }
    return this.get(owner, id);
  }

  /** Re-scan several captures; ones that can't be re-scanned are returned in `skipped`. */
  async rematchBulk(owner: Owner, ids: string[]): Promise<BulkRematchResult> {
    const queued: string[] = [];
    const skipped: BulkRematchResult["skipped"] = [];
    for (const id of ids) {
      const cap = await this.repos.captures.findById(id, owner);
      const reason = cap ? this.rematchBlocker(cap.status) : "not found";
      if (reason) skipped.push({ id, reason });
      else {
        await this.rematch(owner, id);
        queued.push(id);
      }
    }
    return { queued, skipped };
  }

  private rematchBlocker(status: CaptureStatus): string | null {
    if (status === "processing") return "its photos are still being read";
    if (status === "approved" || status === "skipped") return `already ${status}`;
    return null;
  }

  /** Bulk-approve: only `pending_single` captures are eligible; others are skipped. */
  async approveBulk(owner: Owner, ids: string[]): Promise<BulkApproveResult> {
    const approved: string[] = [];
    const skipped: BulkApproveResult["skipped"] = [];
    for (const id of ids) {
      const cap = await this.repos.captures.findById(id, owner);
      if (!cap) skipped.push({ id, reason: "not found" });
      else if (cap.status !== "pending_single") {
        skipped.push({ id, reason: `not eligible (${cap.status})` });
      } else {
        await this.approve(owner, id, {});
        approved.push(id);
      }
    }
    return { approved, skipped };
  }
}

/** Postgres unique_violation (e.g. two requests inserting the same capture id). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
