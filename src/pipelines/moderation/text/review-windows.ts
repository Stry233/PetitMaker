import type { ReviewResult, TextField } from './policy';
import { REVIEW_MAX_CHARS, reviewText, type ReviewWorkerLease } from './reviewer';

/** Characters adjacent windows share before boundary alignment. Alignment moves each edge by at most
 *  `EDGE_SLACK`, so the shared span stays at least `REVIEW_WINDOW_OVERLAP - 2 * EDGE_SLACK`, which
 *  is longer than every restriction entry: a phrase cut by one window's edge lies whole in the next. */
export const REVIEW_WINDOW_OVERLAP = 256;
const EDGE_SLACK = 64;

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}\p{M}]/u.test(char);
const isLowSurrogate = (text: string, i: number) => i > 0 && i < text.length && /[\udc00-\udfff]/.test(text[i]!);

/** Moves a cut at `i` to the nearest word boundary within `EDGE_SLACK` in `direction`, so a window
 *  never opens or closes inside a word whose fragment could read as another word; a run longer
 *  than the slack (unspaced Han text) is cut where it stands, between whole code points. */
function alignCut(text: string, i: number, direction: 1 | -1): number {
  for (let step = 0; step <= EDGE_SLACK; step++) {
    const at = i + direction * step;
    if (at <= 0 || at >= text.length) break;
    if (!isLowSurrogate(text, at) && (!isWordChar(text[at - 1]) || !isWordChar(text[at]))) return at;
  }
  return isLowSurrogate(text, i) ? i + direction : i;
}

/** The [start, end) ranges a review of `text` covers: each at most `REVIEW_MAX_CHARS`, in order, overlapping. */
export function reviewWindowRanges(text: string): [number, number][] {
  if (text.length <= REVIEW_MAX_CHARS) return [[0, text.length]];
  const ranges: [number, number][] = [];
  let start = 0;
  for (;;) {
    const rawEnd = start + REVIEW_MAX_CHARS;
    if (rawEnd >= text.length) {
      ranges.push([start, text.length]);
      return ranges;
    }
    const end = alignCut(text, rawEnd, -1);
    ranges.push([start, end]);
    start = alignCut(text, end - REVIEW_WINDOW_OVERLAP, 1);
  }
}

/** Reviews text of any length window by window under one caller signal, so a deadline bounds the
 *  whole text; the first refusal decides. */
export async function reviewLongText(field: TextField, text: string, signal: AbortSignal, lease?: ReviewWorkerLease): Promise<ReviewResult> {
  for (const [start, end] of reviewWindowRanges(text)) {
    const verdict = await reviewText([{ field, text: text.slice(start, end) }], signal, () => {}, lease);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
