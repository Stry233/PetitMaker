/**
 * Request and response plumbing for one module worker.
 *
 * The client spawns its worker on the first request and keeps it while requests are pending and
 * for `idleMs` after the last one settles (0 terminates it as each settles), and not at all while
 * `holdOpen` answers true. A crash, an unreadable reply or a timeout terminates the worker and fails
 * every pending request, as does a failed post to a one-request worker; the next request spawns a
 * fresh one. A failed post in keyed mode, or a reply `read` throws on, fails only its own request.
 *
 * With `keyed`, requests travel as `{ ...message, id }` and replies are matched by `id`, so several
 * can be in flight. Otherwise the worker serves one request at a time and the message travels as
 * given.
 *
 * A request may name a `fallback`, which answers instead whenever the worker could not: it receives
 * the failure and returns the answer computed another way (usually on this thread) or rethrows.
 * Cancellation through `signal` rejects with an `AbortError` and is never handed to the fallback.
 */

/** How long a worker that serves a surface stays warm after its last request, in ms: long enough
 *  for a reopen to skip the module load, short enough not to hold its heap for the session. */
export const WORKER_IDLE_MS = 30_000;

/** Why the worker did not answer. `heard` says whether the worker had sent this request any message first. */
export class WorkerFailure extends Error {
  constructor(
    readonly kind: 'unsupported' | 'spawn' | 'crash' | 'unreadable' | 'post' | 'timeout' | 'busy' | 'disposed',
    readonly heard: boolean,
    readonly cause?: unknown,
  ) {
    super(`worker ${kind}`);
  }
}

export interface WorkerClientOptions {
  /** Builds the worker. A throw is a `spawn` failure. */
  spawn(): Worker;
  /** How long an idle worker is kept, in ms. */
  idleMs: number;
  keyed?: boolean;
  /** While true, the idle countdown waits; call `client.settle()` when its answer may have changed. */
  holdOpen?: () => boolean;
}

export interface WorkerRequest<R> {
  message: unknown;
  transfer?: Transferable[];
  signal?: AbortSignal;
  /** Fail with `timeout` after this many ms without the answer. */
  timeoutMs?: number;
  /** Reads one message from the worker: the answer, or `undefined` for a message that is not one
   *  (progress, say). Without it, the first message is the answer. */
  read?: (data: unknown) => R | undefined;
  fallback?: (failure: WorkerFailure) => R | Promise<R>;
}

export interface WorkerClient {
  request<R>(req: WorkerRequest<R>): Promise<R>;
  /** Whether a request is pending. */
  readonly busy: boolean;
  /** Re-evaluate the idle countdown, after `holdOpen`'s answer changed. */
  settle(): void;
  /** Terminate the worker now, failing what is pending with `disposed`. */
  dispose(): void;
}

interface Pending {
  heard: boolean;
  read: (data: unknown) => unknown;
  resolve(value: unknown): void;
  fail(failure: WorkerFailure): void;
}

const abortError = () => new DOMException('Cancelled', 'AbortError');

export function createWorkerClient(opts: WorkerClientOptions): WorkerClient {
  let worker: Worker | null = null;
  let nextId = 1;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<number, Pending>();

  const clearIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };

  function terminate(): void {
    clearIdle();
    if (!worker) return;
    worker.terminate();
    worker = null;
  }

  function settle(): void {
    clearIdle();
    if (!worker || pending.size || opts.holdOpen?.()) return;
    if (opts.idleMs <= 0) { terminate(); return; }
    idleTimer = setTimeout(() => { idleTimer = null; terminate(); }, opts.idleMs);
  }

  /** Terminate the worker and fail everything pending with `kind`. */
  function crash(kind: WorkerFailure['kind'], cause?: unknown): void {
    const failed = [...pending.values()];
    pending.clear();
    terminate();
    for (const p of failed) p.fail(new WorkerFailure(kind, p.heard, cause));
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    if (typeof Worker === 'undefined') throw new WorkerFailure('unsupported', false);
    try { worker = opts.spawn(); } catch (err) { throw new WorkerFailure('spawn', false, err); }
    const w = worker;
    // A retired worker's late messages and errors reach handlers that no longer answer for anything.
    w.onmessage = (e: MessageEvent) => {
      if (worker !== w) return;
      const data: unknown = e.data;
      const id = opts.keyed ? (data as { id?: unknown } | null)?.id : pending.keys().next().value;
      if (typeof id !== 'number') return;
      const p = pending.get(id);
      if (!p) return;
      p.heard = true;
      let answer: unknown;
      try { answer = p.read(data); } catch (err) {
        pending.delete(id);
        p.fail(new WorkerFailure('unreadable', true, err));
        settle();
        return;
      }
      if (answer === undefined) return;
      pending.delete(id);
      p.resolve(answer);
      settle();
    };
    w.onerror = () => { if (worker === w) crash('crash'); };
    w.onmessageerror = () => { if (worker === w) crash('unreadable'); };
    return w;
  }

  function request<R>(req: WorkerRequest<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const fail = (failure: WorkerFailure) => {
        if (!req.fallback) { reject(failure); return; }
        try { resolve(req.fallback(failure)); } catch (err) { reject(err); }
      };
      if (req.signal?.aborted) { reject(abortError()); return; }
      if (!opts.keyed && pending.size) { fail(new WorkerFailure('busy', false)); return; }
      let w: Worker;
      try { w = ensureWorker(); } catch (err) { fail(err as WorkerFailure); return; }
      clearIdle();
      const id = nextId++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (!pending.delete(id)) return;
        done();
        // A worker cannot be interrupted, so a one-request worker is retired with its request.
        if (!opts.keyed) terminate(); else settle();
        reject(abortError());
      };
      pending.set(id, {
        heard: false,
        read: (data) => (req.read ? req.read(data) : data as R),
        resolve: (value) => { done(); resolve(value as R); },
        fail: (failure) => { done(); fail(failure); },
      });
      if (req.timeoutMs !== undefined) timer = setTimeout(() => crash('timeout'), req.timeoutMs);
      req.signal?.addEventListener('abort', onAbort, { once: true });
      const message = opts.keyed ? { ...(req.message as object), id } : req.message;
      try {
        if (req.transfer) w.postMessage(message, req.transfer);
        else w.postMessage(message);
      } catch (err) {
        // A message the worker never received fails only its own request where others share it.
        if (!opts.keyed) { crash('post', err); return; }
        const p = pending.get(id);
        pending.delete(id);
        p?.fail(new WorkerFailure('post', false, err));
        settle();
      }
    });
  }

  return {
    request,
    get busy() { return pending.size > 0; },
    settle,
    dispose: () => crash('disposed'),
  };
}
