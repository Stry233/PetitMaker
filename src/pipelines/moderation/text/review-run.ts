import { reviewParts } from './review-parts';
import { loadLexicon } from './segmenter';
import type { ReviewResult, TextPart } from './policy';

/** One review, as the worker and the main-thread fallback both run it. */
export async function runReview(parts: readonly TextPart[]): Promise<ReviewResult> {
  const first = reviewParts(parts);
  // The segmentation lexicon downloads only when a phrase hit needs confirming; approved text never pays for it.
  if (!first.provisional) return first.verdict;
  await loadLexicon();
  return reviewParts(parts).verdict;
}
