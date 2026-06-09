/** Capture serialization + approval/resolution logic shared by the routes. */
import type { Capture, CatalogEntry } from "@sonic/shared";
import { db } from "../db/index.js";
import { storage } from "../storage/index.js";
import { releaseToMatch, releaseToDetail, type ReleaseRow } from "./releases.js";

export async function serializeCapture(id: string): Promise<Capture> {
  const cap = await db
    .selectFrom("capture")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

  const photos = await db
    .selectFrom("capture_photo")
    .selectAll()
    .where("capture_id", "=", id)
    .execute();

  const candidates = await db
    .selectFrom("identification_candidate as ic")
    .innerJoin("release as r", "r.id", "ic.release_id")
    .select(["ic.id as cid", "ic.method", "ic.rank", "r.id as rid"])
    .selectAll("r")
    .where("ic.capture_id", "=", id)
    .orderBy("ic.rank", "asc")
    .execute();

  return {
    id: cap.id,
    status: cap.status,
    barcodeHint: cap.barcode_hint,
    createdAt: new Date(cap.created_at).toISOString(),
    photos: photos.map((p) => ({ id: p.id, type: p.type, url: storage.url(p.storage_key) })),
    candidates: candidates.map((c) => ({
      id: c.cid,
      method: c.method,
      rank: c.rank,
      release: releaseToMatch(c as unknown as ReleaseRow),
    })),
  };
}

/**
 * Promote a capture into the catalog. Handles single-match approval, candidate
 * selection (multiple), and is the hook point for no-match manual resolution.
 */
export async function promoteToCatalog(
  captureId: string,
  body: { candidateId?: string; copy?: Record<string, unknown> },
): Promise<CatalogEntry> {
  // Pick the release: chosen candidate, else the rank-1 candidate.
  const candidate = await db
    .selectFrom("identification_candidate")
    .select(["id", "release_id"])
    .where("capture_id", "=", captureId)
    .$if(!!body.candidateId, (q) => q.where("id", "=", body.candidateId!))
    .orderBy("rank", "asc")
    .executeTakeFirst();

  if (!candidate) {
    throw new Error("no candidate to approve; manual resolution required");
  }

  const copy = body.copy ?? {};
  const entry = await db
    .insertInto("catalog_entry")
    .values({
      capture_id: captureId,
      release_id: candidate.release_id,
      condition: (copy.condition as string) ?? null,
      location: (copy.location as string) ?? null,
      purchase_price: (copy.purchasePrice as number) ?? null,
      purchase_date: (copy.purchaseDate as string) ?? null,
      notes: (copy.notes as string) ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .updateTable("capture")
    .set({ status: "approved", resolved_at: new Date() })
    .where("id", "=", captureId)
    .execute();

  return serializeCatalogEntry(entry.id);
}

export async function serializeCatalogEntry(id: string): Promise<CatalogEntry> {
  const row = await db
    .selectFrom("catalog_entry as ce")
    .innerJoin("release as r", "r.id", "ce.release_id")
    .select([
      "ce.id as id",
      "ce.condition",
      "ce.location",
      "ce.notes",
      "ce.approved_at",
      "ce.capture_id",
    ])
    .selectAll("r")
    .where("ce.id", "=", id)
    .executeTakeFirstOrThrow();

  const photos = row.capture_id
    ? await db
        .selectFrom("capture_photo")
        .selectAll()
        .where("capture_id", "=", row.capture_id)
        .execute()
    : [];

  return {
    id: row.id,
    release: releaseToDetail(row as unknown as ReleaseRow),
    condition: (row.condition as CatalogEntry["condition"]) ?? null,
    location: row.location,
    notes: row.notes,
    approvedAt: new Date(row.approved_at).toISOString(),
    photos: photos.map((p) => ({ id: p.id, type: p.type, url: storage.url(p.storage_key) })),
  };
}
