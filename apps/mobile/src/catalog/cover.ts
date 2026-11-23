import type { CatalogEntry } from "@sonic/shared";

/** Cover art, falling back to the front photo, then any photo. */
export function coverOf(entry: CatalogEntry): string | null {
  return (
    entry.release.coverUrl ??
    entry.photos.find((p) => p.type === "front")?.url ??
    entry.photos[0]?.url ??
    null
  );
}
