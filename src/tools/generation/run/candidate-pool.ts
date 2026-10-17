/**
 * The worker pool candidate generation runs in, so a batch of planet builds runs off the main
 * thread, two or three at once. The macro tool's ghost preview and Change Planet's carry preview (a
 * whole-map transfer replay) share it and jump the queue: a pointer or a loader is waiting on them.
 *
 * The pool is small — `min(3, cores - 2)` — because the main thread still has the map to draw and
 * each worker holds a whole grid. Each slot is one `createWorkerClient` serving one job at a time;
 * the first slot's worker stays warm for the session and the others retire after a minute idle.
 * Jobs queue when every worker is busy; a job aborted while it waits resolves null at once without
 * being sent, and one aborted mid-run finishes in its worker (a worker cannot be interrupted) with
 * the result delivered to a caller that has already decided to drop it.
 *
 * Breakage is a fallback, not an error. A worker that fails to boot (an exotic embedder, a CSP
 * someone tightened), crashes, or will not take a job marks the pool broken and rejects what it
 * holds along with everything that arrives after; the callers catch that and run the same closure
 * on the main thread. A job that threw, or whose answer this thread could not read, rejects alone.
 * `typeof Worker` gates the whole thing, so tests and headless runs never construct one.
 */
import { createWorkerClient, WorkerFailure, type WorkerClient } from '../../../platform/async/worker-client';
import type { GridState, MacroCoord, MapTemplate } from '../../../core/model/types';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import { ruleSetOf, type RuleSetName } from '../../../rules';
import type { GenerateConfig } from '../recipe';
import { MacroRunnerUnavailable, type MacroBuild, type MacroId, type MacroOpts } from '../../macros/run';
import type { MacroPreview } from '../../macros/runtime/preview';
import type { TransferPreview } from './planet-preview';
import type { CandidateAnswers, CandidateJob, CandidateJobs, CandidateReply } from './candidate.worker';
import { reviveCandidate, reviveTransferPreview, wireGrid, type CandidateRun } from './candidate-wire';

type JobKind = keyof CandidateJobs;

interface Job {
  /** The live grid the job runs over; wired at dispatch time, when the receiving worker (and so
   *  its template cache) is known. */
  state: GridState;
  kind: JobKind;
  /** What the job asks besides its grid and templates, which depend on the worker that takes it. */
  request: CandidateJobs[JobKind];
  /** Templates the job names by id besides its grid's own, each sent once per worker like it. */
  templates: readonly MapTemplate[];
  resolve: (answer: Partial<CandidateAnswers[JobKind]> | null) => void;
  reject: (err: Error) => void;
}

interface Slot {
  client: WorkerClient<CandidateJob, CandidateReply>;
  job: Job | null;
  /** Templates the slot's current worker holds; a respawned worker starts with none. */
  templates: Set<string>;
}

/** How long a slot past the first keeps its idle worker, in ms. */
const SURPLUS_IDLE_MS = 60_000;

/** The page's worker slots, spawned on first use; `broken` once workers cannot start; `queue` waits for a free slot. */
let slots: Slot[] | null = null;
let broken = false;
const queue: Job[] = [];

/** Whether the pool can take a job. The offline edition never loads this module: its build replaces
 *  it with `candidate-pool-lite.ts`, so the edition needs no runtime check here. */
export function poolAvailable(): boolean {
  return typeof Worker !== 'undefined' && !broken;
}

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  return Math.min(3, Math.max(1, cores - 2));
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/** The rejection of every job a broken pool holds or is offered; any other rejection is one job's
 *  own failure, on a pool that keeps working. */
export class PoolBroken extends Error {}

function breakPool(cause: Error): void {
  if (broken) return;
  const err = cause instanceof PoolBroken ? cause : new PoolBroken(cause.message);
  broken = true;
  const held = slots ?? [];
  slots = null;
  for (const slot of held) {
    const job = slot.job;
    slot.job = null;
    slot.client.dispose();
    job?.reject(err);
  }
  for (const job of queue.splice(0)) job.reject(err);
}

function makeSlot(index: number): Slot {
  const slot: Slot = {
    client: createWorkerClient<CandidateJob, CandidateReply>({
      spawn: () => {
        slot.templates.clear();
        return new Worker(new URL('./candidate.worker.ts', import.meta.url), { type: 'module' });
      },
      idleMs: SURPLUS_IDLE_MS,
      // The first worker stays warm for the session: the next card or press skips the module load.
      ...(index === 0 ? { holdOpen: () => true } : {}),
    }),
    job: null,
    templates: new Set(),
  };
  return slot;
}

function ensureSlots(demand = 1): Slot[] {
  slots ??= [];
  while (slots.length < Math.min(poolSize(), Math.max(1, demand))) slots.push(makeSlot(slots.length));
  return slots;
}

/** Dispatch never throws: it runs when a job settles as well as inside `enqueue`, and an exception
 *  escaping it leaves the jobs queued behind it unsettled — an await that never returns where every
 *  caller has a main-thread fallback behind a `catch`. A slot that cannot be booted or a payload a
 *  worker refuses therefore breaks the pool, which settles what it holds. */
function dispatch(): void {
  if (broken) return;
  const busy = slots?.filter((slot) => slot.job).length ?? 0;
  for (const slot of ensureSlots(busy + queue.length)) {
    if (slot.job) continue;
    const job = queue.shift();
    if (!job) return;
    slot.job = job;
    try { send(slot, job); } catch (err) { breakPool(asError(err)); return; }
  }
}

function send(slot: Slot, job: Job): void {
  // The worker first: a fresh one holds no templates, and the message says what it is sent.
  slot.client.warm();
  const { state } = job;
  const grid = wireGrid(state, !slot.templates.has(state.template.id));
  slot.templates.add(state.template.id);
  const templates = job.templates.filter((t) => !slot.templates.has(t.id));
  for (const t of templates) slot.templates.add(t.id);
  // The kind and its request travel together; `enqueue` is the one place they are paired.
  const message = { kind: job.kind, ...job.request, grid, ...(templates.length ? { templates } : {}) } as CandidateJob;
  slot.client.request({ message, transfer: [grid.wire.buffer] }).then(
    (reply) => {
      if (slot.job !== job) return;
      slot.job = null;
      if (reply.ok) {
        const { ok: _ok, ...answer } = reply;
        job.resolve(answer);
      } else job.reject(new Error(reply.error));
      dispatch();
    },
    (failure: unknown) => {
      if (slot.job !== job) return;
      // An answer this thread could not read is that job's alone; the slot's next worker takes the next.
      if (failure instanceof WorkerFailure && failure.kind === 'unreadable') {
        slot.job = null;
        job.reject(new Error('generation worker answer could not be read'));
        dispatch();
        return;
      }
      breakPool(asError(failure));
    },
  );
}

function enqueue<K extends JobKind>(
  state: GridState, kind: K, request: CandidateJobs[K],
  opts: { signal?: AbortSignal | undefined; front?: boolean; templates?: MapTemplate[] },
): Promise<Partial<CandidateAnswers[K]> | null> {
  return new Promise((resolve, reject) => {
    // A broken pool takes no jobs: `dispatch` returns at the door, so a job queued here would wait
    // for a worker that is gone. The macro runners are installed once and retire on this rejection.
    if (broken) { reject(new PoolBroken('generation pool is broken')); return; }
    if (opts.signal?.aborted) { resolve(null); return; }
    const job: Job = {
      state, kind, request, templates: opts.templates ?? [],
      // The worker answers each kind with that kind's answer.
      resolve: resolve as Job['resolve'],
      reject,
    };
    // Aborted while it waits: the caller has moved on, so the job settles now and never costs a worker.
    opts.signal?.addEventListener('abort', () => {
      const at = queue.indexOf(job);
      if (at < 0) return;
      queue.splice(at, 1);
      resolve(null);
    }, { once: true });
    if (opts.front) queue.unshift(job);
    else queue.push(job);
    dispatch();
  });
}

/** Warm one worker; concurrent jobs grow the pool to its hardware limit. The first job otherwise pays
 *  the module load, which is the one hitch the pool exists to remove. A no-op without Worker or
 *  once the pool is broken. */
export function warmPool(): void {
  if (!poolAvailable()) return;
  try { ensureSlots()[0]!.client.warm(); } catch (err) {
    breakPool(asError(err));
  }
}

/** The rule set a worker builds to judge a job as `rules` does. A registry with no named set
 *  throws, as one job's failure: the caller runs it in-process against `rules` itself. */
function workerRuleSet(rules: RuleDispatcher): RuleSetName {
  const set = ruleSetOf(rules);
  if (!set) throw new Error('the asking map runs a rule set a worker cannot build');
  return set;
}

/** Run one candidate in the pool. Resolves null when the job was aborted before a worker picked it
 *  up; rejects when the pool is broken (the caller falls back to the main thread). */
export async function runCandidateInPool(
  payload: { state: GridState; config: GenerateConfig; region: MacroCoord[] | null; rules: RuleDispatcher },
  signal?: AbortSignal,
): Promise<CandidateRun | null> {
  const request = { config: payload.config, region: payload.region, rules: workerRuleSet(payload.rules) };
  const data = await enqueue(payload.state, 'candidate', request, { signal });
  return data?.run ? reviveCandidate(data.run, payload.state.template) : null;
}

/** Work out the carry of `state` onto `target` in the pool, at the front of the queue. Resolves null
 *  when `signal` was aborted before a worker picked it up; rejects when the pool is broken. */
export async function runTransferPreviewInPool(
  state: GridState, target: MapTemplate, signal?: AbortSignal,
): Promise<TransferPreview | null> {
  const request = { targetId: target.id, ...(state.annotations ? { annotations: state.annotations } : {}) };
  const data = await enqueue(state, 'transfer', request, { signal, front: true, templates: [target] });
  return data?.preview ? reviveTransferPreview(data.preview, target) : null;
}

/** A macro job in the pool, rejecting as `MacroRunnerUnavailable` once the pool is broken so the
 *  macro runners retire, and with the job's own error otherwise. */
async function enqueueMacroJob<K extends 'preview' | 'macro'>(state: GridState, kind: K, request: CandidateJobs[K]): Promise<Partial<CandidateAnswers[K]> | null> {
  try {
    return await enqueue(state, kind, request, { front: true });
  } catch (err) {
    throw err instanceof PoolBroken ? new MacroRunnerUnavailable(err.message) : err;
  }
}

/** Run one macro preview in the pool, at the front of the queue: a pointer is waiting on it. */
export async function runPreviewInPool(state: GridState, macro: MacroId, opts: MacroOpts, rules: RuleDispatcher): Promise<MacroPreview> {
  const data = await enqueueMacroJob(state, 'preview', { macro, opts, rules: workerRuleSet(rules) });
  if (!data?.preview) throw new Error('preview job dropped');
  return data.preview;
}

/** Build one macro in the pool, at the front of the queue: a press is waiting on it. The landing
 *  half runs back on the caller's thread. */
export async function runMacroBuildInPool(state: GridState, macro: MacroId, opts: MacroOpts, rules: RuleDispatcher): Promise<MacroBuild | null> {
  const data = await enqueueMacroJob(state, 'macro', { macro, opts, rules: workerRuleSet(rules) });
  return data?.built ?? null;
}
