import { reviewParts } from './review-parts';
import { loadLexicon, takeUnconfirmed } from './segmenter';
import type { ReviewResult, TextPart } from './policy';

/** One review, as the worker and the main-thread fallback both run it. */
export async function runReview(parts: readonly TextPart[]): Promise<ReviewResult> {
  let result = reviewParts(parts);
  // The segmentation lexicon downloads only when a phrase hit needs confirming; approved text never pays for it.
  if (takeUnconfirmed()) {
    await loadLexicon();
    result = reviewParts(parts);
  }
  return result;
}
