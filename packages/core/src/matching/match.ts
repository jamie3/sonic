/**
 * Search a metadata source with the extracted fields, strongest identifier
 * first, then score every candidate against the extraction. When the capture's
 * media is known, only releases of that kind are considered (vinyl never
 * matches CD, and vice versa).
 */
import type { ExtractedRelease, MatchMethod, MediaKind, ReleaseMatch } from "@sonic/shared";
import type { MetadataSource } from "../metadata/index.js";
import { compatibleMedia } from "./media.js";
import { decide, type ScoredCandidate, scoreCandidate } from "./score.js";

export interface MatchResult {
  status: "pending_single" | "pending_multiple" | "pending_nomatch";
  candidates: (ScoredCandidate & { method: MatchMethod })[];
  /** Human-readable searches that were run, for the UI. */
  queries: string[];
  /** Candidates dropped because they're the other media kind (vinyl vs CD). */
  excludedByMedia: number;
}

export async function matchRelease(
  source: MetadataSource,
  x: ExtractedRelease,
  media: MediaKind | null = null,
): Promise<MatchResult> {
  const queries: string[] = [];
  const only = media ? ` (${media === "cd" ? "CD" : "vinyl"} only)` : "";
  const found = new Map<string, { match: ReleaseMatch; method: MatchMethod }>();
  let excludedByMedia = 0;
  const collect = (matches: ReleaseMatch[], method: MatchMethod) => {
    for (const m of matches) {
      if (found.has(m.sourceId)) continue;
      // Sources filter by media already; this also catches what they can't
      // (e.g. the Discogs API's format=CD misses CDr/SACD-only formats).
      if (!compatibleMedia(media, m.format)) {
        excludedByMedia++;
        continue;
      }
      found.set(m.sourceId, { match: m, method });
    }
  };

  // 1. Barcode — near-unique.
  if (x.barcode) {
    queries.push(`barcode ${x.barcode}${only}`);
    collect(await source.searchByBarcode(x.barcode.replace(/\D/g, ""), media), "barcode");
  }
  // 2. Catalog number — very distinctive for vinyl; narrowed by artist when known.
  if (x.catalogNumber) {
    queries.push(`catalog no. ${x.catalogNumber}${x.artist ? ` + artist` : ""}${only}`);
    collect(
      await source.searchByText({ catalogNumber: x.catalogNumber, artist: x.artist ?? undefined, media }),
      "ocr",
    );
  }
  // 3. Artist + title — when the identifiers found nothing.
  if (found.size === 0 && (x.artist || x.title)) {
    queries.push(`artist/title "${[x.artist, x.title].filter(Boolean).join(" — ")}"${only}`);
    collect(
      await source.searchByText({ artist: x.artist ?? undefined, title: x.title ?? undefined, media }),
      "vision",
    );
  }

  const scored = [...found.values()].map(({ match, method }) => ({ ...scoreCandidate(x, match), method }));
  const { kept, status } = decide(scored);
  return {
    status,
    candidates: kept.map((k) => ({ ...k, method: scored.find((s) => s.match === k.match)!.method })),
    queries,
    excludedByMedia,
  };
}
