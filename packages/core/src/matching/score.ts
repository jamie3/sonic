/**
 * Quality check: how well a source candidate agrees with what the AI read off
 * the photos. Pure functions, no I/O.
 *
 * - barcode and catalog number are near-unique identifiers: an exact match is
 *   strong evidence; a clear mismatch is strong evidence against.
 * - artist / title / label are compared by similarity (case, accents and
 *   punctuation ignored), so "The Beatles" ≈ "Beatles, The".
 * - year agrees only if equal (reissues share titles but not years).
 */
import type { ExtractedRelease, FieldAgreement, ReleaseMatch } from "@sonic/shared";

type Field = FieldAgreement["field"];

/** How much each field counts toward the score when both sides have it. */
const WEIGHTS: Record<Field, number> = {
  barcode: 4,
  catalogNumber: 3,
  artist: 2,
  title: 2,
  label: 1,
  year: 0.5,
};

export interface ScoredCandidate {
  match: ReleaseMatch;
  score: number; // 0–1
  agreement: FieldAgreement[];
}

/** Lowercase, strip accents and punctuation, drop leading "the", collapse spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .replace(/, the$/, "")
    .trim();
}

/** Catalog numbers: compare letters+digits only ("SHVL-804" = "shvl 804"). */
export function normalizeCatno(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Barcodes: digits only; UPC-A (12) and EAN-13 with a leading 0 are the same code. */
export function normalizeBarcode(s: string): string {
  const d = s.replace(/\D/g, "");
  return d.length === 13 && d.startsWith("0") ? d.slice(1) : d;
}

/** Sørensen–Dice similarity on character bigrams of normalized text, 0–1. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Word-order insensitive containment ("beatles" vs "beatles the").
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  if ([...xs].every((w) => ys.has(w)) || [...ys].every((w) => xs.has(w))) return 0.9;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

function textAgreement(sim: number): FieldAgreement["agreement"] {
  return sim >= 0.85 ? "match" : sim >= 0.55 ? "partial" : "mismatch";
}

/** Compare the extracted fields with one candidate. */
export function scoreCandidate(extracted: ExtractedRelease, match: ReleaseMatch): ScoredCandidate {
  const agreement: FieldAgreement[] = [];
  let earned = 0;
  let possible = 0;

  const add = (field: Field, ex: string | null | undefined, cand: string | null | undefined, credit: number | null) => {
    const e = ex?.trim() || null;
    const c = cand?.trim() || null;
    if (!e || !c || credit === null) {
      agreement.push({ field, extracted: e, candidate: c, agreement: "missing" });
      return;
    }
    possible += WEIGHTS[field];
    earned += WEIGHTS[field] * credit;
    agreement.push({
      field,
      extracted: e,
      candidate: c,
      agreement: credit >= 1 ? "match" : credit > 0 ? "partial" : "mismatch",
    });
  };

  const barcodeCandidate = match.barcode;
  if (extracted.barcode && barcodeCandidate) {
    add("barcode", extracted.barcode, barcodeCandidate,
      normalizeBarcode(extracted.barcode) === normalizeBarcode(barcodeCandidate) ? 1 : 0);
  } else {
    add("barcode", extracted.barcode, barcodeCandidate, null);
  }

  if (extracted.catalogNumber && match.catalogNumber) {
    add("catalogNumber", extracted.catalogNumber, match.catalogNumber,
      normalizeCatno(extracted.catalogNumber) === normalizeCatno(match.catalogNumber) ? 1 : 0);
  } else {
    add("catalogNumber", extracted.catalogNumber, match.catalogNumber, null);
  }

  for (const field of ["artist", "title", "label"] as const) {
    const ex = extracted[field];
    const cand = match[field];
    if (ex && cand) {
      const sim = similarity(ex, cand);
      const verdict = textAgreement(sim);
      add(field, ex, cand, verdict === "match" ? 1 : verdict === "partial" ? 0.5 : 0);
    } else {
      add(field, ex, cand, null);
    }
  }

  const exYear = extracted.year != null ? String(extracted.year) : null;
  const cYear = match.year != null ? String(match.year) : null;
  add("year", exYear, cYear, exYear && cYear ? (exYear === cYear ? 1 : 0) : null);

  // Nothing comparable → no evidence either way.
  const score = possible === 0 ? 0 : earned / possible;
  return { match, score: Math.round(score * 1000) / 1000, agreement };
}

/** Minimum score for a candidate to be shown at all. */
export const MIN_SCORE = 0.4;

/**
 * Sharing an artist/label isn't evidence of the right release: a candidate
 * needs a similar title, or a matching barcode / catalog number.
 */
function plausible(c: ScoredCandidate): boolean {
  const verdict = (field: Field) => c.agreement.find((a) => a.field === field)?.agreement;
  if (verdict("barcode") === "match" || verdict("catalogNumber") === "match") return true;
  return verdict("title") !== "mismatch";
}
/** A clear single match: at least this good… */
export const STRONG_SCORE = 0.75;
/** …and this far ahead of the runner-up. */
export const CLEAR_LEAD = 0.15;

/** Rank candidates and decide the review status from the quality check. */
export function decide(scored: ScoredCandidate[]): {
  kept: ScoredCandidate[];
  status: "pending_single" | "pending_multiple" | "pending_nomatch";
} {
  const kept = scored
    .filter((c) => c.score >= MIN_SCORE && plausible(c))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (kept.length === 0) return { kept, status: "pending_nomatch" };
  const [top, second] = kept;
  const clear = top!.score >= STRONG_SCORE && (!second || top!.score - second.score >= CLEAR_LEAD);
  return { kept, status: kept.length === 1 || clear ? "pending_single" : "pending_multiple" };
}
