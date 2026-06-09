import { z } from "zod";
import { MetadataSourceName } from "./enums.js";

/** A track within a release tracklist. */
export const Track = z.object({
  position: z.string(), // e.g. "A1"
  title: z.string(),
  duration: z.string().optional(), // "5:32"
});
export type Track = z.infer<typeof Track>;

/** A lightweight candidate returned by a metadata search. */
export const ReleaseMatch = z.object({
  source: MetadataSourceName,
  sourceId: z.string(),
  artist: z.string(),
  title: z.string(),
  label: z.string().optional(),
  catalogNumber: z.string().optional(),
  year: z.number().int().optional(),
  country: z.string().optional(),
  format: z.string().optional(), // 'Vinyl, 12", 33 ⅓ RPM'
  thumbUrl: z.string().url().optional(),
});
export type ReleaseMatch = z.infer<typeof ReleaseMatch>;

/** Full canonical release detail, cached in the `release` table. */
export const ReleaseDetail = ReleaseMatch.extend({
  barcode: z.string().optional(),
  genres: z.array(z.string()).default([]),
  styles: z.array(z.string()).default([]),
  coverUrl: z.string().url().optional(),
  tracklist: z.array(Track).default([]),
});
export type ReleaseDetail = z.infer<typeof ReleaseDetail>;
