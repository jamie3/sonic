/** Maps catalog rows to the @sonic/shared `CatalogEntry` DTO. */
import type { CatalogEntry } from "@sonic/shared";
import type { CapturePhotoRow } from "../repositories/capture.repository.js";
import type { CatalogEntryWithRelease } from "../repositories/catalog.repository.js";
import { type PhotoUrlFn, toPhotoDto } from "./capture.mapper.js";
import { toReleaseDetail } from "./release.mapper.js";

export function toCatalogEntryDto(
  row: CatalogEntryWithRelease,
  photos: CapturePhotoRow[],
  tags: string[],
  photoUrl: PhotoUrlFn,
): CatalogEntry {
  return {
    id: row.entry_id,
    release: toReleaseDetail(row),
    condition: (row.condition as CatalogEntry["condition"]) ?? null,
    location: row.location,
    // pg returns numeric as a string; normalize to a number.
    purchasePrice: row.purchase_price == null ? null : Number(row.purchase_price),
    purchaseDate: row.purchase_date ? String(row.purchase_date) : null,
    notes: row.notes,
    tags,
    approvedAt: new Date(row.approved_at).toISOString(),
    photos: photos.map((p) => toPhotoDto(p, photoUrl)),
  };
}
