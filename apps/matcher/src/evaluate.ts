/**
 * Matching evaluation: re-run matching for every approved capture whose
 * approved release came from Discogs, and report whether that release comes
 * out on top and what status the capture would get. Read-only — nothing is
 * written. Use it before and after changing thresholds (matching/score.ts) or
 * search rules to see what the change does on real captures.
 *
 *   pnpm match:evaluate            # local Discogs copy only (no API calls)
 *   pnpm match:evaluate --online   # also use the Discogs API fallback
 */
import type { ExtractedRelease } from "@sonic/shared";
import { db } from "@sonic/core/db";
import { matchRelease } from "@sonic/core/matching/match";
import { captureMedia } from "@sonic/core/matching/media";
import { CLEAR_LEAD, MIN_SCORE, STRONG_SCORE } from "@sonic/core/matching/score";
import { resolveMetadataSource } from "@sonic/core/metadata";

const EMPTY: ExtractedRelease = {
  artist: null, title: null, label: null, catalogNumber: null, barcode: null,
  year: null, country: null, format: null, tracklist: [],
};

async function main() {
  const online = process.argv.includes("--online");
  const sources = await resolveMetadataSource();
  if (!sources.source) throw new Error(`no Discogs source: ${sources.description}`);
  console.log(`thresholds: show ≥ ${MIN_SCORE}, confident ≥ ${STRONG_SCORE} and ${CLEAR_LEAD} ahead`);
  console.log(`source: ${online ? sources.description : `${sources.description.replace(/, then the Discogs API.*$/, "")} — no API calls (pass --online to include it)`}\n`);

  const rows = await db
    .selectFrom("catalog_entry as e")
    .innerJoin("release as r", "r.id", "e.release_id")
    .innerJoin("capture as c", "c.id", "e.capture_id")
    .innerJoin("capture_extraction as x", "x.capture_id", "c.id")
    .select(["c.id as captureId", "c.media", "c.barcode_hint", "x.fields", "r.source_id as approvedId", "r.artist", "r.title", "r.year"])
    .where("r.source", "=", "discogs")
    .execute();
  if (rows.length === 0) {
    console.log("No approved captures with a Discogs release yet — approve some matches first.");
    return;
  }

  const tally = { top: 0, listed: 0, missed: 0, confident: 0, confidentWrong: 0 };
  for (const row of rows) {
    const fields: ExtractedRelease = { ...EMPTY, ...((row.fields as Partial<ExtractedRelease>) ?? {}) };
    fields.barcode ??= row.barcode_hint;
    const media = captureMedia(row.media, fields.format);
    let result = await matchRelease(sources.source, fields, media);
    if (online && result.candidates.length === 0 && sources.fallback) {
      result = await matchRelease(sources.fallback, fields, media);
    }
    const rank = result.candidates.findIndex((c) => c.match.sourceId === row.approvedId) + 1;
    const top = result.candidates[0];
    const verdict = rank === 1 ? "✓ top" : rank > 1 ? `~ #${rank}` : "✗ missing";
    if (rank === 1) tally.top++;
    else if (rank > 1) tally.listed++;
    else tally.missed++;
    if (result.status === "pending_single") {
      tally.confident++;
      if (rank !== 1) tally.confidentWrong++;
    }
    console.log(`${verdict.padEnd(10)} ${row.artist} — ${row.title} (${row.year ?? "?"}, release ${row.approvedId}) → ${result.status}`);
    for (const c of result.candidates.slice(0, 3)) {
      const mark = c.match.sourceId === row.approvedId ? "*" : " ";
      console.log(`   ${mark} ${c.score.toFixed(2)}  ${c.match.artist} — ${c.match.title} | ${c.match.format ?? "?"} | ${c.match.year ?? "?"} | ${c.match.sourceId}`);
    }
    if (rank !== 1) console.log(`     searched: ${result.queries.join(" · ")}`);
  }

  console.log(
    `\n${rows.length} approved capture(s): ${tally.top} approved release ranked #1, ${tally.listed} listed lower, ${tally.missed} not found.` +
      ` ${tally.confident} would be "confident" (pending_single)${tally.confidentWrong ? `, ${tally.confidentWrong} of them WRONG` : ""}.`,
  );
}

main()
  .catch((err) => {
    console.error("match:evaluate failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
