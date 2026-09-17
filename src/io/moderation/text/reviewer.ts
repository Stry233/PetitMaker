import type { ReviewProgress, ReviewResult, TextPart } from './policy';

export class ReviewUnavailable extends Error {}
export class ReviewTooLong extends Error {}

/** A visible editor may reuse initialized package matchers. Idle, closed or interrupted editors release its memory. */
export class ReviewWorkerLease {
  private worker: Worker | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  acquire(): Worker {
    if (this.busy) throw new ReviewUnavailable();
    clearTimeout(this.idle);
    this.worker ??= new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' });
    this.busy = true;
    return this.worker;
  }

  release(): void {
    this.busy = false;
    this.idle = setTimeout(() => this.dispose(), 30_000);
  }

  dispose(): void {
    clearTimeout(this.idle);
    this.worker?.terminate(); this.worker = null; this.busy = false;
  }
}

/** The same review on this thread, for an engine with no module worker to run it in. */
async function reviewOnThread(parts: TextPart[], signal: AbortSignal, progress: (p: ReviewProgress) => void): Promise<ReviewResult> {
  progress({ phase: 'checking' });
  let result: ReviewResult;
  // Submitted text and internal stacks must not enter UI error reporting.
  try { result = await (await import('./review-run')).runReview(parts); } catch { throw new ReviewUnavailable(); }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  return result;
}

/** Approval is per request; package matchers may outlive a check within the worker lease. */
export async function reviewText(parts: TextPart[], signal: AbortSignal, progress: (p: ReviewProgress) => void, lease?: ReviewWorkerLease): Promise<ReviewResult> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!parts.length) return { allowed: true };
  if (parts.reduce((n, p) => n + p.text.length + (p.segments?.reduce((size, text) => size + text.length, 0) ?? 0), 0) > 4096) throw new ReviewTooLong();
  if (typeof Worker === 'undefined') return reviewOnThread(parts, signal, progress);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = lease ? lease.acquire() : new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' }); }
    catch (e) {
      // A busy lease refuses the concurrent request; an engine that cannot build the worker reviews here.
      if (e instanceof ReviewUnavailable) reject(e); else resolve(reviewOnThread(parts, signal, progress));
      return;
    }
    let finished = false;
    let heard = false;
    const finish = (result?: ReviewResult, error?: Error, fallback = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      if (lease) { if (error || fallback) lease.dispose(); else lease.release(); }
      else worker.terminate();
      if (fallback) resolve(reviewOnThread(parts, signal, progress));
      else if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException('Cancelled', 'AbortError'));
    // Includes worker bundle loading on slow connections; cancellation remains available.
    const timer = setTimeout(() => finish(undefined, new ReviewUnavailable()), 30_000);
    signal.addEventListener('abort', abort, { once: true });
    // An error before the first message is a worker that never started: the engine lacks module
    // workers or cannot parse the chunk, and the review runs here instead.
    worker.onerror = () => (heard ? finish(undefined, new ReviewUnavailable()) : finish(undefined, undefined, true));
    worker.onmessageerror = () => finish(undefined, new ReviewUnavailable());
    worker.onmessage = ({ data }: MessageEvent<{ progress?: ReviewProgress; result?: ReviewResult; error?: true }>) => {
      heard = true;
      if (data.progress) progress(data.progress);
      else if (data.result) finish(data.result);
      else finish(undefined, new ReviewUnavailable());
    };
    try { worker.postMessage(parts); } catch { finish(undefined, new ReviewUnavailable()); }
  });
}
