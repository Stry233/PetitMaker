// The text review on this thread, with the errors and limits every way of running it shares. Kept apart
// from `reviewer.ts`, which names the review's worker, so a build with no workers runs the same review.
import type { ReviewProgress, ReviewResult, TextPart } from './policy';
import { throwIfAborted } from '../../../platform/async/abort';

export class ReviewUnavailable extends Error {}
export class ReviewTooLong extends Error {}

/** The most characters one review accepts, segments included. */
export const REVIEW_MAX_CHARS = 4096;

/** Whether `parts` hold more than one review accepts. */
export const reviewTooLong = (parts: readonly TextPart[]): boolean => parts.reduce(
  (n, p) => n + p.text.length + (p.segments?.reduce((size, text) => size + text.length, 0) ?? 0), 0,
) > REVIEW_MAX_CHARS;

/** The review on this thread. */
export async function reviewOnThread(parts: TextPart[], signal: AbortSignal, progress: (p: ReviewProgress) => void): Promise<ReviewResult> {
  progress({ phase: 'checking' });
  let result: ReviewResult;
  // Submitted text and internal stacks must not enter UI error reporting.
  try { result = await (await import('./review-run')).runReview(parts); } catch { throw new ReviewUnavailable(); }
  throwIfAborted(signal);
  return result;
}
