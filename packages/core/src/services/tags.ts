/** Tag-name rules shared by every path that writes tags. */
export const MAX_TAG_LENGTH = 50;
export const MAX_TAGS_PER_ENTRY = 50;

/**
 * Trim, collapse inner whitespace, drop blanks, cap length, and de-duplicate
 * case-insensitively (first occurrence wins).
 */
export function normalizeTags(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_TAGS_PER_ENTRY) break;
  }
  return out;
}
