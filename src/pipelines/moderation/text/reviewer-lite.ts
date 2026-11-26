// The text check of the Lite build, which aliases this module for `reviewer.ts` and runs no workers: the
// same review on this thread, then, where the host's container checks text itself, that check on each
// text part under its field as the scene. The container's verdict is the last word; one that could not run
// leaves the text unchecked.
import type * as Workers from './reviewer';
import type { TextField } from './policy';
import { throwIfAborted } from '../../../platform/async/abort';
import { checkHostText } from '../../../platform/host/host-bridge';
import { ReviewTooLong, ReviewUnavailable, reviewOnThread, reviewTooLong } from './review-here';

export { REVIEW_MAX_CHARS, ReviewTooLong, ReviewUnavailable } from './review-here';

/** No worker to lease here; callers keep one and release it as they would the worker's. */
export class ReviewWorkerLease {
  dispose(): void {}
}

export const reviewText: typeof Workers.reviewText = async (parts, signal, progress) => {
  throwIfAborted(signal);
  if (!parts.length) return { allowed: true };
  if (reviewTooLong(parts)) throw new ReviewTooLong();
  const local = await reviewOnThread(parts, signal, progress);
  const hostCheck = checkHostText;
  if (!local.allowed || !hostCheck) return local;
  const refused: TextField[] = [];
  for (const part of parts) {
    const verdict = await hostCheck(part.text, part.field);
    throwIfAborted(signal);
    if (verdict === 'too-long') throw new ReviewTooLong();
    if (verdict === 'unavailable') throw new ReviewUnavailable();
    if (verdict === 'rejected') refused.push(part.field);
  }
  return refused.length ? { allowed: false, reason: 'content', fields: refused } : { allowed: true };
};
