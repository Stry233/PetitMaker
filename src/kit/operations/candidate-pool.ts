/**
 * The worker pool candidate generation runs in, so a batch of planet builds runs OFF the main
 * thread: the page stays smooth while six generations run, and two or three run at once instead
 * of one after another. The macro tool's ghost preview shares it — the same closure at a smaller
 * size — and jumps the queue, since a preview answers a pointer that is waiting right now while a
 * card can arrive a moment later.
 *
 * The pool is small — `min(3, cores - 2)` — because the main thread still has the
 * map to draw and each worker holds a whole grid. Jobs queue when every worker is busy; a job
 * whose signal is cancelled before it is dispatched resolves null without being sent, and one
 * cancelled mid-run finishes in its worker (a worker cannot be interrupted) with the result
 * delivered to a caller that has already decided to drop it.
 *
 * BREAKAGE IS A FALLBACK, NOT AN ERROR. A worker that fails to boot (an exotic embedder, a CSP
 * someone tightened), or a job one will not take, marks the pool broken and rejects what it holds
 * along with everything that arrives after; the callers catch that and run the same closure on the
 * main thread. `typeof Worker` gates the whole thing, so tests and headless runs never construct
 * one.
 */
import { decodeCells, encodeCells, type WireCells } from '../../core/model/grid-wire';
import type { Command, GenerateConfig, GridState, MacroCoord, MapTemplate, PlacedObject } from '../../core/model/types';
import type { MacroBuild, MacroId, MacroOpts, MacroPreview } from '../../tools/macros';
import type { Outcome } from './outcome';

/**
 * A grid on the wire: cells as one transferable buffer (`core/model/grid-wire`), objects and
 * locks as plain lists, and the TEMPLATE only the first time each worker sees it — a template is
 * immutable per map and its `zones` array is as big as the cells. The provenance ledger and the
 * objects delta never cross: no job reads them.
 */
export interface WireGrid {
  wire: WireCells;
  objects: PlacedObject[];
  lockedLayers: number[];
  cellsVersion: number;
  objectsVersion: number;
  templateId: string;
  template?: MapTemplate;
}

/** What a worker hands back for a candidate: the grid it built, the run's report, the accepted
 *  commands ready for a replay on the live map, and the fingerprint of the ground they were
 *  validated against (the copy after the run's own clearing). */
export interface CandidateRun {
  state: GridState;
  outcome: Outcome;
  commands: Command[];
  bare: string;
}

/** The same, as it crosses. The grid goes back the way it came — one transferable buffer rather
 *  than ~24k nested objects — because the ANSWER is deserialized on the main thread, where the
 *  clone costs the frame the pool exists to protect. The template never crosses either way: this
 *  side has the one the job was sent with. */
export interface WireCandidate {
  wire: WireCells;
  objects: PlacedObject[];
  lockedLayers: number[];
  cellsVersion: number;
  objectsVersion: number;
  outcome: Outcome;
  commands: Command[];
  bare: string;
}

interface Job {
  id: number;
  /** The live grid the job runs over; wired at DISPATCH time, when the receiving worker (and so
   *  its template cache) is known. */
  state: GridState;
  payload: Record<string, unknown>;
  signal?: { cancelled: boolean } | undefined;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

interface Slot { worker: Worker; job: Job | null; templates: Set<string> }

let slots: Slot[] | null = null;
let broken = false;
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Job[] = [];

export function poolAvailable(): boolean {
  return typeof Worker !== 'undefined' && !broken;
}

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  return Math.min(3, Math.max(1, cores - 2));
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

function breakPool(err: Error): void {
  broken = true;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  for (const slot of slots ?? []) {
    slot.worker.terminate();
    slot.job?.reject(err);
    slot.job = null;
  }
  slots = null;
  for (const job of queue.splice(0)) job.reject(err);
}

function ensureSlots(demand = 1): Slot[] {
  slots ??= [];
  while (slots.length < Math.min(poolSize(), Math.max(1, demand))) {
    const worker = new Worker(new URL('./candidate.worker.ts', import.meta.url), { type: 'module' });
    const slot: Slot = { worker, job: null, templates: new Set() };
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { id: number; ok: boolean; error?: string } & Record<string, unknown>;
      const job = slot.job;
      slot.job = null;
      if (job && job.id === data.id) {
        if (data.ok) job.resolve(data);
        else job.reject(new Error(data.error ?? 'generation worker failed'));
      }
      dispatch();
    };
    worker.onerror = () => breakPool(new Error('generation worker broke'));
    // An answer this thread cannot deserialize carries no job id, so the slot's own job is the one
    // to settle. The worker itself is intact, so it keeps its place and takes the next job.
    worker.onmessageerror = () => {
      const job = slot.job;
      slot.job = null;
      job?.reject(new Error('generation worker answer could not be read'));
      dispatch();
    };
    slots.push(slot);
  }
  return slots;
}

function retireIdleSlots(): void {
  if (idleTimer !== null || queue.length || !slots || slots.length < 2 || slots.some(slot => slot.job)) return;
  idleTimer = setTimeout(() => {
    for (const slot of slots?.splice(1) ?? []) slot.worker.terminate();
    idleTimer = null;
  }, 60_000);
}

/** DISPATCH NEVER THROWS: it runs inside a worker's own message handler as well as inside
 *  `enqueue`, and an exception escaping that handler leaves the job that failed to post, and
 *  everything queued behind it, unsettled — an await that never returns where every caller has a
 *  main-thread fallback behind a `catch`. A slot that cannot be booted or a payload a worker
 *  refuses therefore breaks the pool, which settles what it holds. */
function dispatch(): void {
  if (broken) return;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  if (!queue.length && slots?.every(slot => !slot.job)) { retireIdleSlots(); return; }
  let ready: Slot[];
  try { ready = ensureSlots((slots?.filter(slot => slot.job).length ?? 0) + queue.filter(job => !job.signal?.cancelled).length); } catch (err) { breakPool(asError(err)); return; }
  for (const slot of ready) {
    if (slot.job) continue;
    let job = queue.shift();
    // Drop cancelled jobs before they cost a worker: the caller has already moved on.
    while (job && job.signal?.cancelled) { job.resolve(null); job = queue.shift(); }
    if (!job) { retireIdleSlots(); return; }
    slot.job = job;
    try { post(slot, job); } catch (err) { breakPool(asError(err)); return; }
  }
}

function post(slot: Slot, job: Job): void {
  const { state } = job;
  const grid: WireGrid = {
    wire: encodeCells(state.cells, state.template.width, state.template.height),
    objects: [...state.objects.values()],
    lockedLayers: [...state.lockedLayers],
    cellsVersion: state.cellsVersion ?? 0,
    objectsVersion: state.objectsVersion ?? 0,
    templateId: state.template.id,
    ...(slot.templates.has(state.template.id) ? {} : { template: state.template }),
  };
  slot.templates.add(state.template.id);
  slot.worker.postMessage({ id: job.id, grid, ...job.payload }, [grid.wire.buffer]);
}

function enqueue(state: GridState, payload: Record<string, unknown>, opts: { signal?: { cancelled: boolean }; front?: boolean }): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    // A broken pool takes no jobs: `dispatch` returns at the door, so a job queued here would wait
    // for a worker that is gone. The macro runners are installed once and retire on a rejection,
    // so this rejection is also how they learn.
    if (broken) { reject(new Error('generation pool is broken')); return; }
    const job: Job = { id: nextId++, state, payload, signal: opts.signal, resolve, reject };
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
  try { ensureSlots(); } catch (err) {
    breakPool(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Run one candidate in the pool. Resolves null when the job's signal was cancelled before a
 *  worker picked it up; rejects when the pool is broken (the caller falls back to the main
 *  thread). */
export async function runCandidateInPool(
  payload: { state: GridState; config: GenerateConfig; region: MacroCoord[] | null },
  signal?: { cancelled: boolean },
): Promise<CandidateRun | null> {
  const data = await enqueue(payload.state, { kind: 'candidate', config: payload.config, region: payload.region }, { signal }) as { run?: WireCandidate } | null;
  return data?.run ? reviveCandidate(data.run, payload.state.template) : null;
}

/** The worker's answer as a grid again. Exported for the test that holds the two ends of the wire
 *  equal — nothing else builds one. */
export function reviveCandidate(run: WireCandidate, template: MapTemplate): CandidateRun {
  return {
    state: {
      template,
      cells: decodeCells(run.wire),
      objects: new Map(run.objects.map((o) => [o.id, o])),
      lockedLayers: new Set(run.lockedLayers),
      cellsVersion: run.cellsVersion,
      objectsVersion: run.objectsVersion,
    },
    outcome: run.outcome,
    commands: run.commands,
    bare: run.bare,
  };
}

/** Run one macro preview in the pool, at the FRONT of the queue: a pointer is waiting on it. */
export async function runPreviewInPool(state: GridState, macro: MacroId, opts: MacroOpts): Promise<MacroPreview> {
  const data = await enqueue(state, { kind: 'preview', macro, opts }, { front: true }) as { preview?: MacroPreview } | null;
  if (!data?.preview) throw new Error('preview job dropped');
  return data.preview;
}

/** Build one macro in the pool, at the FRONT of the queue: a press is waiting on it. The landing
 *  half runs back on the caller's thread. */
export async function runMacroBuildInPool(state: GridState, macro: MacroId, opts: MacroOpts): Promise<MacroBuild | null> {
  const data = await enqueue(state, { kind: 'macro', macro, opts }, { front: true }) as { built?: MacroBuild | null } | null;
  return data?.built ?? null;
}
