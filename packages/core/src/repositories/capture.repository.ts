import type { Kysely, Selectable } from "kysely";
import type { CaptureStatus, MatchMethod, MediaKind, PhotoType } from "@sonic/shared";
import type {
  CaptureExtractionTable,
  CaptureMatchTable,
  CapturePhotoTable,
  CaptureTable,
  Database,
} from "../db/types.js";
import type { ReleaseRow } from "../mappers/release.mapper.js";
import type { Owner } from "./owner.js";

export type CaptureRow = Selectable<CaptureTable>;
export type CaptureExtractionRow = Selectable<CaptureExtractionTable>;
export type CaptureMatchRow = Selectable<CaptureMatchTable>;
export type CapturePhotoRow = Selectable<CapturePhotoTable>;

/** A candidate joined with its release; `cid` is the candidate id, `id` the release id. */
export type CandidateWithRelease = ReleaseRow & {
  cid: string;
  method: MatchMethod;
  rank: number;
  score: number | null;
  agreement: unknown;
};

export interface NewCandidate {
  releaseId: string;
  method: MatchMethod;
  rank: number;
  extracted: unknown;
  score?: number | null;
  agreement?: unknown;
}

/** Data access for captures, their photos, and identification candidates. */
export class CaptureRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** A live capture (not in the trash). */
  findById(id: string, owner: Owner): Promise<CaptureRow | undefined> {
    return this.db
      .selectFrom("capture")
      .selectAll()
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .executeTakeFirst();
  }

  /** Any capture, trashed or not (trash operations). */
  findByIdIncludingTrashed(id: string, owner: Owner): Promise<CaptureRow | undefined> {
    return this.db.selectFrom("capture").selectAll().where("id", "=", id).$if(owner !== null, (q) => q.where("user_id", "=", owner!)).executeTakeFirst();
  }

  /** Live captures with one of the statuses, newest first. */
  listByStatus(statuses: CaptureStatus[], owner: Owner): Promise<CaptureRow[]> {
    return this.db
      .selectFrom("capture")
      .selectAll()
      .where("status", "in", statuses)
      .where("deleted_at", "is", null)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .orderBy("created_at", "desc")
      .execute();
  }

  /** Move to / take out of the trash. Returns whether a row changed. */
  async setDeleted(id: string, at: Date | null, owner: Owner): Promise<boolean> {
    const r = await this.db
      .updateTable("capture")
      .set({ deleted_at: at })
      .where("id", "=", id)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .where("deleted_at", at ? "is" : "is not", null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  /**
   * Trashed captures that aren't catalog entries themselves (an approved
   * capture is trashed via its entry). Most recently deleted first.
   */
  listTrashed(owner: Owner): Promise<CaptureRow[]> {
    return this.db
      .selectFrom("capture")
      .selectAll()
      .where("deleted_at", "is not", null)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .where("status", "!=", "approved")
      .orderBy("deleted_at", "desc")
      .execute();
  }

  /** Ids of trashed (non-approved) captures deleted before `cutoff` (the owner's, or everyone's). */
  async listTrashedBefore(cutoff: Date, owner: Owner): Promise<string[]> {
    const rows = await this.db
      .selectFrom("capture")
      .select("id")
      .where("deleted_at", "<", cutoff)
      .where("status", "!=", "approved")
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * Permanently delete a capture that is in the trash (photos + candidates
   * cascade). Refuses live captures. Returns whether a row was deleted.
   */
  async hardDeleteTrashed(id: string, owner: Owner): Promise<boolean> {
    const r = await this.db
      .deleteFrom("capture")
      .where("id", "=", id)
      .$if(owner !== null, (q) => q.where("user_id", "=", owner!))
      .where("deleted_at", "is not", null)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /**
   * Permanently delete the approved capture behind a purged catalog entry.
   * Only approved captures — never a live unidentified one.
   */
  async hardDeleteApproved(id: string): Promise<void> {
    await this.db.deleteFrom("capture").where("id", "=", id).where("status", "=", "approved").execute();
  }

  findPhotos(captureId: string): Promise<CapturePhotoRow[]> {
    return this.db
      .selectFrom("capture_photo")
      .selectAll()
      .where("capture_id", "=", captureId)
      .execute();
  }

  async findCandidates(captureId: string): Promise<CandidateWithRelease[]> {
    const rows = await this.db
      .selectFrom("identification_candidate as ic")
      .innerJoin("release as r", "r.id", "ic.release_id")
      .select(["ic.id as cid", "ic.method", "ic.rank", "ic.score", "ic.agreement"])
      .selectAll("r")
      .where("ic.capture_id", "=", captureId)
      .orderBy("ic.rank", "asc")
      .execute();
    return rows as unknown as CandidateWithRelease[];
  }

  findExtraction(captureId: string): Promise<CaptureExtractionRow | undefined> {
    return this.db
      .selectFrom("capture_extraction")
      .selectAll()
      .where("capture_id", "=", captureId)
      .executeTakeFirst();
  }

  /** Store (or replace) the extractor's result for a capture. Call in a transaction. */
  async saveExtraction(input: {
    captureId: string;
    engine: string;
    model: string | null;
    fields: unknown;
    rawText: string;
    error: string | null;
    durationMs: number | null;
  }): Promise<void> {
    const values = {
      engine: input.engine,
      model: input.model,
      fields: JSON.stringify(input.fields),
      raw_text: input.rawText,
      error: input.error,
      duration_ms: input.durationMs,
      extracted_at: new Date(),
    };
    await this.db
      .insertInto("capture_extraction")
      .values({ capture_id: input.captureId, ...values })
      .onConflict((oc) => oc.column("capture_id").doUpdateSet(values))
      .execute();
  }

  findMatch(captureId: string): Promise<CaptureMatchRow | undefined> {
    return this.db.selectFrom("capture_match").selectAll().where("capture_id", "=", captureId).executeTakeFirst();
  }

  /** Store (or replace) the online-source search outcome. Call in a transaction. */
  async saveMatch(input: {
    captureId: string;
    source: string;
    outcome: CaptureMatchRow["outcome"];
    message: string | null;
    queries: string[];
  }): Promise<void> {
    const values = {
      source: input.source,
      outcome: input.outcome,
      message: input.message,
      queries: JSON.stringify(input.queries),
      matched_at: new Date(),
    };
    await this.db
      .insertInto("capture_match")
      .values({ capture_id: input.captureId, ...values })
      .onConflict((oc) => oc.column("capture_id").doUpdateSet(values))
      .execute();
  }

  /** The chosen candidate when `candidateId` is given, else the rank-1 candidate. */
  findCandidate(
    captureId: string,
    candidateId?: string,
  ): Promise<{ id: string; release_id: string } | undefined> {
    return this.db
      .selectFrom("identification_candidate")
      .select(["id", "release_id"])
      .where("capture_id", "=", captureId)
      .$if(!!candidateId, (q) => q.where("id", "=", candidateId!))
      .orderBy("rank", "asc")
      .executeTakeFirst();
  }

  /** Insert a capture and its photo rows. Call inside a transaction. */
  async createWithPhotos(input: {
    id: string;
    userId: string;
    media: MediaKind | null;
    barcodeHint: string | null;
    photos: { type: PhotoType; storageKey: string; width?: number; height?: number }[];
  }): Promise<void> {
    await this.db
      .insertInto("capture")
      .values({
        id: input.id,
        user_id: input.userId,
        status: "processing",
        media: input.media,
        barcode_hint: input.barcodeHint,
      })
      .execute();
    await this.db
      .insertInto("capture_photo")
      .values(
        input.photos.map((p) => ({
          capture_id: input.id,
          type: p.type,
          storage_key: p.storageKey,
          width: p.width ?? null,
          height: p.height ?? null,
        })),
      )
      .execute();
  }

  async setStatus(id: string, status: CaptureStatus, resolvedAt?: Date): Promise<void> {
    await this.db
      .updateTable("capture")
      .set(resolvedAt ? { status, resolved_at: resolvedAt } : { status })
      .where("id", "=", id)
      .execute();
  }

  /** Replace all candidates for a capture. Call inside a transaction. */
  async replaceCandidates(captureId: string, candidates: NewCandidate[]): Promise<void> {
    await this.db
      .deleteFrom("identification_candidate")
      .where("capture_id", "=", captureId)
      .execute();
    if (candidates.length === 0) return;
    await this.db
      .insertInto("identification_candidate")
      .values(
        candidates.map((c) => ({
          capture_id: captureId,
          release_id: c.releaseId,
          method: c.method,
          rank: c.rank,
          extracted: c.extracted ? JSON.stringify(c.extracted) : null,
          score: c.score ?? null,
          agreement: c.agreement ? JSON.stringify(c.agreement) : null,
        })),
      )
      .execute();
  }
}
