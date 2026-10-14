import { runReview } from './review-run';
import type { ReviewProgress, ReviewResult, TextPart } from './policy';
import { workerScope } from '../../../platform/async/worker-client';

export type TextReviewRequest = TextPart[];
/** Any number of `progress` messages, then the result, or `error` when the check failed. */
export type TextReviewReply = { progress: ReviewProgress } | { result: ReviewResult } | { error: true };

const scope = workerScope<TextReviewRequest, TextReviewReply>();
scope.listen(async (parts) => {
  try {
    scope.post({ progress: { phase: 'checking' } });
    scope.post({ result: await runReview(parts) });
  } catch {
    // Submitted text and internal stacks must not enter UI error reporting.
    scope.post({ error: true });
  }
});
