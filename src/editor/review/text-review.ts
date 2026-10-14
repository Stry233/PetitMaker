// The text check behind one surface that names or describes something: one worker lease, at most one
// check in flight, and the last completed result kept for its exact text. The surface's hook keeps
// the timer that waits for typing to settle and the composition gating.
import {
  reviewText, ReviewTooLong, ReviewWorkerLease, type ReviewProgress, type ReviewResult, type TextPart,
} from '../../pipelines/moderation';

export type { ReviewProgress, ReviewResult, TextPart };

/** Why a text cannot go out: a refusal, a check that could not run, or text past the check's budget. */
export type ReviewIssue = Exclude<ReviewResult, { allowed: true }> | 'unavailable' | 'too-long';

/** What a running check reports while it is the current one. */
export interface TextReviewListener {
  progress(progress: ReviewProgress): void;
  settled(result: ReviewResult): void;
  failed(issue: 'unavailable' | 'too-long'): void;
}

/** The key a check's approval belongs to: the exact resolved text, never the draft's identity. */
export const textReviewKey = (parts: readonly TextPart[]): string => JSON.stringify(parts);

interface Run { key: string; controller: AbortController; promise: Promise<ReviewResult> }

export class TextReviewer {
  private readonly lease = new ReviewWorkerLease();
  private completed: { key: string; result: ReviewResult } | null = null;
  private active: Run | null = null;

  /** The completed result for `key`, if the last finished check was of it. */
  resultFor(key: string): ReviewResult | undefined {
    return this.completed?.key === key ? this.completed.result : undefined;
  }

  /** Whether a check of `parts` would start a new run rather than reuse a result or the current run. */
  wouldStart(parts: readonly TextPart[]): boolean {
    const key = textReviewKey(parts);
    return parts.length > 0 && !this.resultFor(key) && this.active?.key !== key;
  }

  /** Checks `parts`, reusing the result or the run for the same text; any other run is cancelled.
   *  `listener` hears only while this run is current. */
  check(parts: TextPart[], listener: TextReviewListener): Promise<ReviewResult> {
    const key = textReviewKey(parts);
    if (!parts.length) return Promise.resolve({ allowed: true });
    const done = this.resultFor(key);
    if (done) return Promise.resolve(done);
    if (this.active?.key === key) return this.active.promise;
    this.cancel();
    const controller = new AbortController();
    const run = { key, controller } as Run;
    this.active = run;
    listener.progress({ phase: 'checking' });
    run.promise = reviewText(parts, controller.signal, (progress) => {
      if (this.active === run) listener.progress(progress);
    }, this.lease).then((result) => {
      if (this.active === run) {
        this.completed = { key, result };
        listener.settled(result);
      }
      return result;
    }, (error: unknown) => {
      if (this.active === run) listener.failed(error instanceof ReviewTooLong ? 'too-long' : 'unavailable');
      throw error;
    }).finally(() => { if (this.active === run) this.active = null; });
    return run.promise;
  }

  /** Stops the running check; the key it was checking, if any. */
  cancel(): string | undefined {
    const run = this.active;
    this.active = null;
    run?.controller.abort();
    return run?.key;
  }

  /** Forgets the completed result, as a closed window does. */
  forget(): void {
    this.completed = null;
  }

  /** Releases the check's worker. */
  dispose(): void {
    this.lease.dispose();
  }
}
