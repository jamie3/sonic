import type { CaptureStatus, ExtractedRelease } from "@sonic/shared";
import { NotFoundError } from "../errors.js";
import { matchRelease } from "../matching/match.js";
import { captureMedia } from "../matching/media.js";
import type { MetadataSource } from "../metadata/index.js";
import type { Repositories, TransactionRunner } from "../repositories/index.js";

const EMPTY: ExtractedRelease = {
  artist: null,
  title: null,
  label: null,
  catalogNumber: null,
  barcode: null,
  year: null,
  country: null,
  format: null,
  tracklist: [],
};

/**
 * Matching stage (apps/matcher, `recognize` jobs): for a capture in "review" —
 * extracted by the AI — search the metadata source with the extracted fields,
 * score each candidate against them (quality check), store the candidates and
 * the outcome, and move the capture to pending_single / pending_multiple /
 * pending_nomatch for the owner to approve. Finding nothing is a normal
 * outcome: the owner approves with the AI's (corrected) reading instead.
 */
export class MatchingService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    /** null when no source is configured (no DISCOGS_TOKEN): matching is skipped. */
    private readonly source: MetadataSource | null,
    /** Tried when `source` finds nothing — the Discogs API behind the local copy. */
    private readonly fallback: MetadataSource | null = null,
  ) {}

  async handle(captureId: string): Promise<CaptureStatus> {
    const cap = await this.repos.captures.findByIdIncludingTrashed(captureId, null);
    if (!cap) throw new NotFoundError(`capture ${captureId} not found`);
    // Only captures waiting for matching; duplicates/trashed/resolved are left alone.
    if (cap.status !== "review" || cap.deleted_at) return cap.status;

    const extraction = await this.repos.captures.findExtraction(captureId);
    const fields: ExtractedRelease = {
      ...EMPTY,
      ...((extraction?.fields as Partial<ExtractedRelease> | undefined) ?? {}),
    };
    fields.barcode ??= cap.barcode_hint;

    if (!this.source) {
      await this.finish(captureId, "pending_nomatch", [], {
        outcome: "skipped",
        message:
          "No Discogs source is set up (import the data dumps or set DISCOGS_TOKEN), so no match was attempted.",
        queries: [],
      });
      return "pending_nomatch";
    }

    if (!fields.barcode && !fields.catalogNumber && !fields.artist && !fields.title) {
      await this.finish(captureId, "pending_nomatch", [], {
        outcome: "no_match",
        message: "Nothing legible to search with — enter the details when approving.",
        queries: [],
      });
      return "pending_nomatch";
    }

    // Vinyl or CD: chosen on the phone, else read off the photos. Candidates of
    // the other kind are never offered.
    const media = captureMedia(cap.media, fields.format);

    // Errors here (rate limit, network) propagate so pg-boss retries.
    let result = await matchRelease(this.source, fields, media);
    let foundOnline = false;
    if (result.candidates.length === 0 && this.fallback) {
      // Not in the local copy (too new, or a dump that predates it): ask the API.
      const online = await matchRelease(this.fallback, fields, media);
      foundOnline = online.candidates.length > 0;
      result = { ...online, queries: [...result.queries, ...online.queries.map((q) => `online: ${q}`)] };
    }

    // Cache the candidate releases (idempotent upserts, safe outside the transaction).
    const candidates = [];
    for (const [i, c] of result.candidates.entries()) {
      candidates.push({
        releaseId: await this.repos.releases.upsert(c.match),
        method: c.method,
        rank: i + 1,
        extracted: fields,
        score: c.score,
        agreement: c.agreement,
      });
    }

    await this.finish(captureId, result.status, candidates, {
      outcome: candidates.length ? "matched" : "no_match",
      message: candidates.length
        ? foundOnline
          ? "Not in the local Discogs copy — found on Discogs online."
          : null
        : media
          ? `No ${media === "cd" ? "CD" : "vinyl"} match found on Discogs.`
          : "No match found on Discogs.",
      queries: result.queries,
    });
    return result.status;
  }

  /** Out of retries: don't strand the capture — hand it to the owner to approve manually. */
  async giveUp(captureId: string, error: string): Promise<void> {
    await this.finish(captureId, "pending_nomatch", [], {
      outcome: "error",
      message: `Couldn't search Discogs: ${error}`,
      queries: [],
    });
  }

  /** Captures in "review" (extracted, awaiting a match), oldest first. */
  async findAwaitingMatch(): Promise<string[]> {
    const rows = await this.repos.captures.listByStatus(["review"], null);
    return rows.map((r) => r.id).reverse();
  }

  private async finish(
    captureId: string,
    status: CaptureStatus,
    candidates: Parameters<Repositories["captures"]["replaceCandidates"]>[1],
    match: { outcome: "matched" | "no_match" | "skipped" | "error"; message: string | null; queries: string[] },
  ) {
    await this.tx.run(async (repos) => {
      // Re-check: the owner may have trashed or re-read it meanwhile.
      const current = await repos.captures.findById(captureId, null);
      if (!current || current.status !== "review") return;
      await repos.captures.replaceCandidates(captureId, candidates);
      await repos.captures.saveMatch({ captureId, source: "discogs", ...match });
      await repos.captures.setStatus(captureId, status);
    });
  }
}
