/**
 * Seeds the database with fake catalog data for local development.
 * Idempotent: re-running replaces the prior seed set without touching real
 * (non-seed) rows. Invoked via `pnpm db:seed`.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Condition } from "@sonic/shared";
import { createRepositories } from "../repositories/index.js";
import { normalizeTags } from "../services/tags.js";
import { db } from "./index.js";

const SEED_SOURCE = "seed";

/**
 * Deterministic UUID (v5-style) derived from a key, so re-seeding always
 * produces the SAME ids. This keeps bookmarked/linked detail URLs stable
 * across `db:reset` runs instead of regenerating random ids each time.
 */
function seedUuid(key: string): string {
  const h = createHash("sha1").update(`sonic-seed:${key}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${variant}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

type SeedRecord = {
  artist: string;
  title: string;
  label: string;
  catalogNumber: string;
  barcode: string;
  year: number;
  country: string;
  format: string;
  genres: string[];
  styles: string[];
  condition: Condition;
  location: string;
  notes: string | null;
};

const RECORDS: SeedRecord[] = [
  { artist: "Pink Floyd", title: "The Dark Side of the Moon", label: "Harvest", catalogNumber: "SHVL 804", barcode: "5099902987612", year: 1973, country: "UK", format: "LP, Album", genres: ["Rock"], styles: ["Prog Rock", "Psychedelic Rock"], condition: "NM", location: "Shelf A1", notes: "Solid blue triangle pressing." },
  { artist: "Miles Davis", title: "Kind of Blue", label: "Columbia", catalogNumber: "CL 1355", barcode: "5099706350613", year: 1959, country: "US", format: "LP, Album, Mono", genres: ["Jazz"], styles: ["Modal"], condition: "VG+", location: "Shelf A2", notes: null },
  { artist: "Fleetwood Mac", title: "Rumours", label: "Warner Bros.", catalogNumber: "BSK 3010", barcode: "0075992732611", year: 1977, country: "US", format: "LP, Album", genres: ["Rock", "Pop"], styles: ["Soft Rock"], condition: "VG", location: "Shelf A3", notes: "Light surface noise on side B." },
  { artist: "Daft Punk", title: "Discovery", label: "Virgin", catalogNumber: "7243 8 49606 1 6", barcode: "0724384960616", year: 2001, country: "France", format: "2×LP, Album", genres: ["Electronic"], styles: ["House", "Disco"], condition: "M", location: "Shelf B1", notes: null },
  { artist: "Radiohead", title: "OK Computer", label: "Parlophone", catalogNumber: "NODATA 02", barcode: "0724385522916", year: 1997, country: "UK", format: "2×LP, Album", genres: ["Rock", "Electronic"], styles: ["Alternative Rock", "Art Rock"], condition: "NM", location: "Shelf B2", notes: null },
  { artist: "Stevie Wonder", title: "Songs in the Key of Life", label: "Tamla", catalogNumber: "T13-340C2", barcode: "0731453007512", year: 1976, country: "US", format: "2×LP, Album", genres: ["Funk / Soul"], styles: ["Soul"], condition: "VG+", location: "Shelf B3", notes: "Includes the bonus 7\"." },
  { artist: "Kendrick Lamar", title: "To Pimp a Butterfly", label: "Top Dawg / Aftermath", catalogNumber: "B0022954-01", barcode: "0602547330659", year: 2015, country: "US", format: "2×LP, Album", genres: ["Hip Hop"], styles: ["Conscious", "Jazzy Hip-Hop"], condition: "M", location: "Shelf C1", notes: null },
  { artist: "The Velvet Underground & Nico", title: "The Velvet Underground & Nico", label: "Verve", catalogNumber: "V6-5008", barcode: "0731453122819", year: 1967, country: "US", format: "LP, Album", genres: ["Rock"], styles: ["Art Rock", "Experimental"], condition: "G+", location: "Shelf C2", notes: "Peeled banana; cover worn." },
  { artist: "Aphex Twin", title: "Selected Ambient Works 85–92", label: "Apollo", catalogNumber: "AMB 3922", barcode: "5021603392212", year: 1992, country: "Belgium", format: "2×LP, Album", genres: ["Electronic"], styles: ["IDM", "Ambient"], condition: "VG+", location: "Shelf C3", notes: null },
  { artist: "Amy Winehouse", title: "Back to Black", label: "Island", catalogNumber: "1713041", barcode: "0602517130418", year: 2006, country: "Europe", format: "LP, Album", genres: ["Funk / Soul", "Pop"], styles: ["Soul", "Rhythm & Blues"], condition: "NM", location: "Shelf D1", notes: null },
  { artist: "Nirvana", title: "Nevermind", label: "DGC", catalogNumber: "DGC-24425", barcode: "0720642442517", year: 1991, country: "US", format: "LP, Album", genres: ["Rock"], styles: ["Grunge", "Alternative Rock"], condition: "VG", location: "Shelf D2", notes: "Original inner sleeve intact." },
  { artist: "Bill Evans Trio", title: "Sunday at the Village Vanguard", label: "Riverside", catalogNumber: "RLP 376", barcode: "0025218601429", year: 1961, country: "US", format: "LP, Album", genres: ["Jazz"], styles: ["Post Bop", "Cool Jazz"], condition: "VG+", location: "Shelf D3", notes: null },
];

export async function seed(): Promise<void> {
  const repos = createRepositories(db);
  let inserted = 0;
  // Seed into the first account (catalogs are per user). Optionally pick one: SEED_USERNAME=…
  const wanted = process.env.SEED_USERNAME?.toLowerCase();
  const owner = await db
    .selectFrom("users")
    .select(["id", "username"])
    .$if(!!wanted, (q) => q.where("username", "=", wanted!))
    .orderBy("created_at")
    .executeTakeFirst();
  if (!owner) {
    throw new Error(
      wanted ? `no account named "${wanted}"` : "no accounts yet — sign up (or start the API once) before seeding",
    );
  }
  console.log(`seeding into ${owner.username}'s catalog`);

  for (let i = 0; i < RECORDS.length; i++) {
    const rec = RECORDS[i]!;
    const sourceId = `seed-${String(i + 1).padStart(3, "0")}`;
    const coverUrl = `https://picsum.photos/seed/${sourceId}/600/600`;

    // Upsert the release so re-running the seed updates rather than duplicates.
    const release = await db
      .insertInto("release")
      .values({
        id: seedUuid(`release:${sourceId}`),
        source: SEED_SOURCE,
        source_id: sourceId,
        artist: rec.artist,
        title: rec.title,
        label: rec.label,
        catalog_number: rec.catalogNumber,
        barcode: rec.barcode,
        year: rec.year,
        country: rec.country,
        format: rec.format,
        source_tags: [...rec.genres, ...rec.styles],
        cover_url: coverUrl,
      })
      .onConflict((oc) =>
        oc.constraint("release_source_unique").doUpdateSet({
          artist: rec.artist,
          title: rec.title,
          label: rec.label,
          catalog_number: rec.catalogNumber,
          barcode: rec.barcode,
          year: rec.year,
          country: rec.country,
          format: rec.format,
          source_tags: [...rec.genres, ...rec.styles],
          cover_url: coverUrl,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    // Replace any prior catalog entry for this seed release.
    await db.deleteFrom("catalog_entry").where("release_id", "=", release.id).execute();
    await db
      .insertInto("catalog_entry")
      .values({
        id: seedUuid(`entry:${sourceId}`),
        user_id: owner.id,
        release_id: release.id,
        capture_id: null,
        condition: rec.condition,
        location: rec.location,
        notes: rec.notes,
      })
      .execute();
    // Tag the entry the way approval would: from the release's source tags.
    await repos.tags.setForEntry(
      seedUuid(`entry:${sourceId}`),
      normalizeTags([...rec.genres, ...rec.styles]),
    );

    inserted++;
  }

  await repos.tags.deleteUnused();
  console.log(`✓ seeded ${inserted} catalog entries`);
}

async function main() {
  try {
    await seed();
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// Only run automatically when invoked directly (not when imported by reset).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
