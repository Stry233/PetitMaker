import type { ReviewProgress, ReviewResult, TextPart } from './policy';
import { createWorkerClient, WORKER_IDLE_MS } from '../../../platform/async/worker-client';
import { throwIfAborted } from '../../../platform/async/abort';
import type { TextReviewReply, TextReviewRequest } from './review.worker';
import { ReviewTooLong, ReviewUnavailable, reviewOnThread, reviewTooLong } from './review-here';

export { REVIEW_MAX_CHARS, ReviewTooLong, ReviewUnavailable } from './review-here';

const spawnReviewWorker = () => new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' });

/** A visible editor may reuse initialized package matchers. Idle, closed or interrupted editors release its memory. */
export class ReviewWorkerLease {
  /** One check at a time; the worker stays warm after each. */
  readonly client = createWorkerClient<TextReviewRequest, TextReviewReply>({ spawn: spawnReviewWorker, idleMs: WORKER_IDLE_MS });

  /** Release the worker now; a check in flight fails as unavailable. */
  dispose(): void {
    this.client.dispose();
  }
}

/** Approval is per request; package matchers may outlive a check within the worker lease. */
export async function reviewText(
  parts: TextPart[], signal: AbortSignal, progress: (p: ReviewProgress) => void, lease?: ReviewWorkerLease,
): Promise<ReviewResult> {
  throwIfAborted(signal);
  if (!parts.length) return { allowed: true };
  if (reviewTooLong(parts)) throw new ReviewTooLong();
  if (typeof Worker === 'undefined') return reviewOnThread(parts, signal, progress);
  const client = lease?.client ?? createWorkerClient<TextReviewRequest, TextReviewReply>({ spawn: spawnReviewWorker, idleMs: 0 });
  // Null is the worker reporting that its check failed.
  const result = await client.request<ReviewResult | null>({
    message: parts, signal,
    // Includes worker bundle loading on slow connections; cancellation remains available.
    timeoutMs: 30_000,
    read: (reply) => {
      if ('progress' in reply) { progress(reply.progress); return undefined; }
      return 'result' in reply ? reply.result : null;
    },
    fallback: (failure) => {
      // A worker that cannot be built, or breaks before its first message, is an engine that lacks
      // module workers or cannot parse the chunk: the review runs here instead. A busy lease
      // refuses the concurrent request.
      if (failure.kind === 'spawn' || (failure.kind === 'crash' && !failure.heard)) return reviewOnThread(parts, signal, progress);
      throw new ReviewUnavailable();
    },
  });
  if (!result) { client.dispose(); throw new ReviewUnavailable(); }
  return result;
}
