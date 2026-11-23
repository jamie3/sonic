/**
 * Vinyl vs CD. A capture is one or the other (chosen on the phone, or read off
 * the photos), and a candidate release must be that kind: vinyl only matches
 * vinyl, CD only CD — never the other kind, a digital file, a cassette, etc.
 * Pure functions, no I/O.
 */
import type { MediaKind } from "@sonic/shared";

/** Discogs format names per media kind (the `name` of each <format>). */
export const FORMAT_NAMES: Record<MediaKind, string[]> = {
  vinyl: ["Vinyl", "Lathe Cut", "Acetate", "Flexi-disc", "Shellac"],
  cd: ["CD", "CDr", "CDV", "SACD", "HDCD"],
};

const PATTERNS: Record<MediaKind, RegExp> = {
  // "Vinyl", "LP", "2×LP", '12"', "7 inch", "45 RPM", "Lathe Cut", "Flexi-disc", "Shellac"
  vinyl: /\bvinyl\b|(?:\b|\d[x×]?|×)LPs?\b|\b(?:7|10|12)\s*(?:"|″|”|''|-?\s*inch)|\brpm\b|\blathe\b|\bacetate\b|\bflexi|\bshellac\b/i,
  // "CD", "2×CD", "CDr", "SACD", "HDCD", "SHM-CD", "Blu-spec CD", "Compact Disc"
  cd: /(?:\b|\d|×|-)(?:SA|HD)?CD(?:r|V|s|2)?\b|\bcompact\s+disc\b/i,
};

/** Which media kinds a format text mentions — e.g. 'Vinyl, LP + CD' → {vinyl, cd}. */
export function mediaInFormat(format: string | null | undefined): Set<MediaKind> {
  const found = new Set<MediaKind>();
  if (!format) return found;
  for (const kind of ["vinyl", "cd"] as const) if (PATTERNS[kind].test(format)) found.add(kind);
  return found;
}

/**
 * The capture's media: what was chosen on the phone, else what the extractor
 * read off the photos ("LP", "CD", …) when that's unambiguous, else unknown.
 */
export function captureMedia(chosen: MediaKind | null | undefined, extractedFormat: string | null | undefined): MediaKind | null {
  if (chosen) return chosen;
  const read = mediaInFormat(extractedFormat);
  return read.size === 1 ? [...read][0]! : null;
}

/**
 * Whether a candidate can be the captured item: vinyl only matches vinyl, CD
 * only CD. A candidate whose format doesn't include the capture's kind is out
 * — the other kind, but also digital files, cassettes, DVDs… A set that
 * includes it (a vinyl + CD box) stays in, and so does a release with no
 * recorded format (nothing to judge by).
 */
export function compatibleMedia(media: MediaKind | null, candidateFormat: string | null | undefined): boolean {
  if (!media) return true;
  if (!candidateFormat?.trim()) return true;
  return mediaInFormat(candidateFormat).has(media);
}
