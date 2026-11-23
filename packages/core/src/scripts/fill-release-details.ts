/**
 * Backfill: fetch the full Discogs record (tracklist, cover, …) for catalog
 * releases that have no tracklist — e.g. ones approved from a Discogs API
 * search hit before approval fetched details. Local copy first, then the API.
 *   pnpm releases:fill-details
 */
import { db } from "../db/index.js";
import { resolveMetadataSource } from "../metadata/index.js";
import { createRepositories } from "../repositories/index.js";
import { ReleaseDetailsService } from "../services/release-details.service.js";

async function main() {
  const metadata = await resolveMetadataSource();
  console.log(`release details via ${metadata.description}`);
  const service = new ReleaseDetailsService(createRepositories(db), [metadata.source, metadata.fallback]);
  const results = await service.fillCatalog("discogs");
  if (results.length === 0) console.log("nothing to do: every Discogs release in the catalog has a tracklist and a cover");
  for (const r of results) {
    const row = await db.selectFrom("release").select(["artist", "title", "tracklist", "cover_url"]).where("id", "=", r.id).executeTakeFirst();
    const tracks = Array.isArray(row?.tracklist) ? row.tracklist.length : 0;
    console.log(`  ${r.result.padEnd(11)} ${row?.artist} — ${row?.title}${r.result === "filled" ? ` (${tracks} tracks, cover: ${row?.cover_url ? "yes" : "no"})` : ""}${r.error ? `: ${r.error}` : ""}`);
  }
}

main()
  .catch((err) => {
    console.error("fill-release-details failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
