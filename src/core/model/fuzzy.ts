/*
 * fuzzy.ts — a small, dependency-free fuzzy string scorer.
 *
 * TIERS, highest first: a literal contiguous match beats a scattered (subsequence) one. Within a
 * literal match, one that starts at a WORD boundary (the string's own start, or right after a
 * separator like a space or a parenthesis) beats one buried mid-word. Within a scattered match,
 * fewer/longer contiguous runs and a word-aligned first hit score higher — a query that drops one
 * letter of a real word ("aple" for "apple") still lands well above one that shares only stray
 * letters. The three tiers are non-overlapping score BANDS, so comparing two scores from any two
 * calls is always meaningful regardless of which tier produced them.
 *
 * CJK carries no spaces between its own characters, so a whole CJK name reads as one "word" for
 * boundary purposes (a match only counts as word-start at the name's own beginning or after a real
 * separator like the parenthesis around a character's nickname). The scattered tier is what lets an
 * abbreviated CJK query still find its target without every character present — "苹树" inside
 * "苹果树" — since there is no space to make "prefix of a word" do that job the way it does in en.
 *
 * Folding (`fold`) is case- and width-insensitive (NFKC collapses full-width Latin/punctuation to
 * their standard forms) and diacritic-insensitive (NFD strips combining marks), matching
 * `state/catalog.ts`'s existing rule so "cafe" still finds "Café".
 */

/** Tier floors, one `TIER_STEP` apart. A tier's own bonus never reaches the next tier's floor (see
 *  `MAX_BONUS` below), so the bands never overlap — exported so a caller that weighs DIFFERENT
 *  kinds of field against each other (`state/catalog.ts`: an item's own name vs. an authored
 *  alias) can pull a raw score apart into "which tier" and "how far into it" without duplicating
 *  these constants, and re-portion that second part, while the tier itself keeps dominating. */
export const TIER_STEP = 1_000_000;
const TIER_WORD_SUBSTRING = 3 * TIER_STEP;
const TIER_SUBSTRING = 2 * TIER_STEP;
const TIER_SUBSEQUENCE = 1 * TIER_STEP;

/** The ceiling any bonus can add within its tier: comfortably under one tier step. Exported for
 *  the same re-portioning reason as `TIER_STEP`. */
export const MAX_BONUS = 900_000;

/** Splits a `fuzzyScore` result back into its tier floor and the bonus above it (0..MAX_BONUS). */
export function tierAndBonus(score: number): { tier: number; bonus: number } {
  const tier = Math.floor(score / TIER_STEP) * TIER_STEP;
  return { tier, bonus: score - tier };
}

function fold(s: string): string {
  return s.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** A "letter or number" in any script, Unicode-property aware — CJK ideographs count, so a run of
 *  them is one word and a space/punctuation boundary is what starts the next. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordStart(s: string, i: number): boolean {
  return i <= 0 || !WORD_CHAR.test(s[i - 1]!);
}

/**
 * Score `candidate` against `query`; null if `candidate` doesn't match at all (a whitespace-only
 * query never matches). Higher is a better match.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const q = fold(query.trim());
  const c = fold(candidate);
  if (!q) return null;

  const at = c.indexOf(q);
  if (at !== -1) {
    // Coverage: how much of the candidate the query accounts for — "fir" matching the whole of
    // "Fir" outranks "fir" lost inside a much longer name.
    const coverage = q.length / c.length;
    const bonus = Math.round(coverage * MAX_BONUS);
    return (isWordStart(c, at) ? TIER_WORD_SUBSTRING : TIER_SUBSTRING) + bonus;
  }

  // Subsequence fallback: every query character must appear in candidate, in order, not
  // necessarily touching. Greedy earliest-match — catalog names are a few words at most, so the
  // earliest alignment is never worse than a later one would be.
  let ci = 0;
  let runs = 0;
  let firstIndex = -1;
  let prevIndex = -2;
  for (const ch of q) {
    const idx = c.indexOf(ch, ci);
    if (idx === -1) return null;
    if (firstIndex === -1) firstIndex = idx;
    if (idx !== prevIndex + 1) runs += 1;
    prevIndex = idx;
    ci = idx + 1;
  }
  // The scattered tier exists to abbreviate a real WORD ("aple" for "apple", "苹树" for "苹果树"),
  // not to let letters strung together by coincidence pass as one — a query landing mid-word is
  // never that abbreviation, only noise ("tree" starting inside "paTteRnEd", never at a word of its
  // own). Anchoring just the first hit at a word start is enough: it still lets the rest of the run
  // wander across later words (an abbreviation can legitimately trail off into the next word), and a
  // literal contiguous match — which needs no anchor — always outranks this tier regardless.
  if (!isWordStart(c, firstIndex)) return null;
  const qLen = [...q].length;
  // 1.0 = the whole query landed as one unbroken run; lower = more of it was scattered.
  const contiguity = qLen > 1 ? 1 - (runs - 1) / qLen : 1;
  const bonus = Math.round(contiguity * MAX_BONUS * 0.7)
    + (isWordStart(c, firstIndex) ? Math.round(MAX_BONUS * 0.3) : 0);
  return TIER_SUBSEQUENCE + bonus;
}
