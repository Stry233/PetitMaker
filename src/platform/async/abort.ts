/*
 * Cancellation helpers over AbortSignal. Written by hand rather than with `AbortSignal.any`,
 * `AbortSignal.timeout`, `signal.throwIfAborted` or `scheduler.yield`, which the oldest supported
 * browsers (Chrome 85, Safari 14.1) lack.
 */

/** The rejection a cancelled wait settles with: a DOMException named AbortError, or a plain Error of
 *  that name where the runtime has no DOMException. */
export function abortError(message = 'Cancelled'): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/** Whether `err` is a cancellation rather than a failure. */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** Throws `abortError()` when `signal` has already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** A controller that aborts with its parent. `dispose` detaches it from the parent (and stops a
 *  deadline) without aborting it; call it once the work the controller guards has settled. */
export interface LinkedController {
  readonly signal: AbortSignal;
  abort(): void;
  dispose(): void;
}

/** A child of `parent`: aborting the child leaves the parent alone, and an already-aborted parent
 *  yields an already-aborted child, since an aborted signal never fires `abort` again. */
export function linkedController(parent?: AbortSignal): LinkedController {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => parent?.removeEventListener('abort', onAbort),
  };
}

/** `linkedController` that also aborts itself `ms` after it is made. */
export function withDeadline(ms: number, parent?: AbortSignal): LinkedController {
  const linked = linkedController(parent);
  const timer = setTimeout(linked.abort, ms);
  return {
    signal: linked.signal,
    abort: linked.abort,
    dispose: () => { clearTimeout(timer); linked.dispose(); },
  };
}

/** Resolves on a later macrotask, after pending input, paint and timers have had their turn. */
export function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
