/**
 * Request and response plumbing for one module worker.
 *
 * The client spawns its worker on the first request (or on `warm`) and keeps it while requests are
 * pending and for `idleMs` after the last one settles (0 terminates it as each settles), and not at
 * all while `holdOpen` answers true. A crash, an unreadable reply or a timeout terminates the worker and fails
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
import { abortError } from './abort';

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

interface WorkerClientOptions {
  /** Builds the worker. A throw is a `spawn` failure. */
  spawn(): Worker;
  /** How long an idle worker is kept, in ms. */
  idleMs: number;
  keyed?: boolean;
  /** While true, the idle countdown waits; call `client.settle()` when its answer may have changed. */
  holdOpen?: () => boolean;
}

/** One request to a worker that takes `Req` and posts `Reply` messages; `R` is what it resolves to. */
export interface WorkerRequest<Req, Reply, R> {
  message: Req;
  transfer?: Transferable[];
  signal?: AbortSignal;
  /** Fail with `timeout` after this many ms without the answer. */
  timeoutMs?: number;
  /** Reads one message from the worker: the answer, or `undefined` for a message that is not one
   *  (progress, say). Without it, the first message is the answer. */
  read?: (data: Reply) => R | undefined;
  fallback?: (failure: WorkerFailure) => R | Promise<R>;
}

/** A client of a worker that takes `Req` and posts `Reply` messages, both as its worker module
 *  declares them. In keyed mode the wire adds an `id` to both, which the client owns. */
export interface WorkerClient<Req, Reply> {
  request(req: WorkerRequest<Req, Reply, Reply>): Promise<Reply>;
  request<R>(req: WorkerRequest<Req, Reply, R> & { read: (data: Reply) => R | undefined }): Promise<R>;
  /** Whether a request is pending. */
  readonly busy: boolean;
  /** Re-evaluate the idle countdown, after `holdOpen`'s answer changed. */
  settle(): void;
  /** Spawn the worker now if none is running, so the next request skips the module load. Throws the
   *  `unsupported` or `spawn` failure a request would meet. */
  warm(): void;
  /** Terminate the worker now, failing what is pending with `disposed`. */
  dispose(): void;
}

interface Pending {
  heard: boolean;
  read: (data: unknown) => unknown;
  resolve(value: unknown): void;
  fail(failure: WorkerFailure): void;
}


export function createWorkerClient<Req, Reply>(opts: WorkerClientOptions): WorkerClient<Req, Reply> {
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

  function request<R>(req: WorkerRequest<Req, Reply, R>): Promise<R> {
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
        // The worker module's protocol types what it posts.
        read: (data) => (req.read ? req.read(data as Reply) : data as R),
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
    warm: () => { ensureWorker(); settle(); },
    dispose: () => crash('disposed'),
  };
}

/** A message on a keyed client's wire: the protocol message with the client's request id. */
export type Keyed<T> = T & { id: number };

/** The worker side of a protocol, and the one place a worker module reads its global scope: it
 *  receives `In` and posts `Out`, both `Keyed` for a keyed client. */
export function workerScope<In, Out>(): {
  listen(handler: (data: In) => void): void;
  post(message: Out, transfer?: Transferable[]): void;
} {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<In>) => void) | null;
    postMessage(message: Out, transfer?: Transferable[]): void;
  };
  return {
    listen: (handler) => { scope.onmessage = ({ data }) => handler(data); },
    post: (message, transfer) => { if (transfer) scope.postMessage(message, transfer); else scope.postMessage(message); },
  };
}
