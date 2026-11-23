import { z } from "zod";
import { MetadataSourceName } from "./enums.js";

/** A track within a release tracklist. */
export const Track = z.object({
  position: z.string(), // e.g. "A1"
  title: z.string(),
  duration: z.string().optional(), // "5:32"
});
export type Track = z.infer<typeof Track>;

/**
 * Where a release's metadata came from: a metadata source, hand entry, or the
 * dev seed script. Wider than MetadataSourceName because cached rows can hold
 * any of these.
 */
// "edited": a user's own copy of a shared source release, made when they edit its details.
export const ReleaseSource = z.enum([...MetadataSourceName.options, "manual", "seed", "edited"]);
export type ReleaseSource = z.infer<typeof ReleaseSource>;

/** A lightweight candidate returned by a metadata search. */
export const ReleaseMatch = z.object({
  source: ReleaseSource,
  sourceId: z.string(),
  artist: z.string(),
  title: z.string(),
  label: z.string().optional(),
  catalogNumber: z.string().optional(),
  year: z.number().int().optional(),
  country: z.string().optional(),
  format: z.string().optional(), // 'Vinyl, 12", 33 ⅓ RPM'
  barcode: z.string().optional(), // digits; used by the matching quality check
  thumbUrl: z.string().url().optional(),
  /**
   * Source-provided classifications (e.g. Discogs genres + styles). Not shown as
   * tags directly — they seed a catalog entry's tags when it's approved.
   */
  suggestedTags: z.array(z.string()).optional(),
});
export type ReleaseMatch = z.infer<typeof ReleaseMatch>;

/** Full canonical release detail, cached in the `release` table. */
export const ReleaseDetail = ReleaseMatch.extend({
  barcode: z.string().optional(),
  coverUrl: z.string().url().optional(),
  tracklist: z.array(Track).default([]),
});
export type ReleaseDetail = z.infer<typeof ReleaseDetail>;
