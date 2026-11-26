// The outcome of the text check an export or a shared link runs on its words as they go out.
import { automaticTextReview, isReviewTooLong } from './edition-review';
import type { ReviewIssue, ReviewResult, TextPart } from './text-review';

/** Why the words in `parts` may not go out yet, where this edition checks them as they go: the check's
 *  refusal, or a check that could not run or could not take them; null once they may. `checking`
 *  hears a check start and settle. */
export async function heldWords(
  parts: TextPart[], checkText: (parts: TextPart[]) => Promise<ReviewResult>, checking?: (running: boolean) => void,
): Promise<ReviewIssue | null> {
  if (!automaticTextReview || !parts.length) return null;
  checking?.(true);
  try {
    const result = await checkText(parts);
    return result.allowed ? null : result;
  } catch (error) {
    return isReviewTooLong(error) ? 'too-long' : 'unavailable';
  } finally {
    checking?.(false);
  }
}
