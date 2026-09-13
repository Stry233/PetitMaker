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

/** Approval is per request; package matchers may outlive a check within the worker lease. */
export async function reviewText(parts: TextPart[], signal: AbortSignal, progress: (p: ReviewProgress) => void, lease?: ReviewWorkerLease): Promise<ReviewResult> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!parts.length) return { allowed: true };
  if (parts.reduce((n, p) => n + p.text.length + (p.segments?.reduce((size, text) => size + text.length, 0) ?? 0), 0) > 4096) throw new ReviewTooLong();
  if (typeof Worker === 'undefined') throw new ReviewUnavailable();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = lease ? lease.acquire() : new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new ReviewUnavailable()); return; }
    let finished = false;
    const finish = (result?: ReviewResult, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      if (lease) { if (error) lease.dispose(); else lease.release(); }
      else worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException('Cancelled', 'AbortError'));
    // Includes worker bundle loading on slow connections; cancellation remains available.
    const timer = setTimeout(() => finish(undefined, new ReviewUnavailable()), 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(undefined, new ReviewUnavailable());
    worker.onmessageerror = () => finish(undefined, new ReviewUnavailable());
    worker.onmessage = ({ data }: MessageEvent<{ progress?: ReviewProgress; result?: ReviewResult; error?: true }>) => {
      if (data.progress) progress(data.progress);
      else if (data.result) finish(data.result);
      else finish(undefined, new ReviewUnavailable());
    };
    try { worker.postMessage(parts); } catch { finish(undefined, new ReviewUnavailable()); }
  });
}
