/**
 * THE POOL SETTLES EVERY JOB IT TAKES, whatever goes wrong with the workers.
 *
 * Every caller of the pool awaits it with a main-thread fallback ready behind a `catch`
 * (`generate.ts:buildCandidate`, `macros/run.ts:applyMacroAsync`, `macros/preview.ts`), so a
 * rejection costs a frame and a hang costs the feature: a generate card that never arrives, a
 * macro press that never lands. `Worker` does not exist in this environment, so the pool is driven
 * here by a fake one whose `postMessage` can be made to fail the way a real one does (a payload
 * structured-clone refuses, a worker already gone), and each test asserts the same thing — that
 * every job settled, one way or the other.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CellZone } from '../../core/model/types';
import type { GenerateConfig, GridState, MapTemplate } from '../../core/model/types';

type Pool = typeof import('../../kit/operations/candidate-pool');

interface Posted { worker: FakeWorker; id: number; hasTemplate: boolean }

/** Which job ids the next `postMessage` refuses. Armed per test. */
let failPost: (id: number) => boolean = () => false;
let constructFails = false;
let totalPosts = 0;
const posted: Posted[] = [];

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  terminated = false;

  constructor(_url: URL, _opts?: unknown) {
    if (constructFails) throw new Error('worker blocked');
    FakeWorker.all.push(this);
  }

  postMessage(msg: unknown, _transfer?: unknown[]): void {
    const { id, grid } = msg as { id: number; grid: { template?: unknown } };
    if (failPost(id)) throw new Error('DataCloneError: could not be cloned');
    totalPosts++;
    posted.push({ worker: this, id, hasTemplate: grid.template !== undefined });
  }

  terminate(): void { this.terminated = true; }
}

/** Hand one queued question its answer, the way a worker does. Returns whatever escaped the
 *  message handler, which for a healthy pool is nothing. */
function deliverOne(): unknown {
  const next = posted.shift();
  if (!next) throw new Error('nothing was posted');
  try {
    next.worker.onmessage?.({ data: { id: next.id, ok: true } } as MessageEvent);
    return null;
  } catch (err) {
    return err;
  }
}

/** An answer this thread cannot deserialize, the way a browser reports one. */
function refuseOne(): unknown {
  const next = posted.shift();
  if (!next) throw new Error('nothing was posted');
  try {
    next.worker.onmessageerror?.({ type: 'messageerror' });
    return null;
  } catch (err) {
    return err;
  }
}

/** A 2x2 planet: enough for the pool to encode a grid, and nothing crosses the wire here anyway. */
function tinyState(): GridState {
  const template: MapTemplate = {
    id: 'pool-test', name: { en: 'pool-test' }, width: 2, height: 2,
    zones: [[CellZone.Grass, CellZone.Grass], [CellZone.Grass, CellZone.Grass]],
    plaza: { x: 0.5, y: 0.5, width: 1, height: 1, elevation: 0, color: '#E2E8F0' },
  };
  return {
    template,
    cells: [
      [{ zone: CellZone.Grass, terrain: null }, { zone: CellZone.Grass, terrain: null }],
      [{ zone: CellZone.Grass, terrain: null }, { zone: CellZone.Grass, terrain: null }],
    ],
    objects: new Map(),
    lockedLayers: new Set(),
  };
}

const config: GenerateConfig = {
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed: 1, region: null,
  richness: 1,
};

/** The pool keeps its slots and its broken flag at module scope, so each test gets its own copy. */
async function loadPool(): Promise<Pool> {
  vi.resetModules();
  return import('../../kit/operations/candidate-pool');
}

/** Every job's fate as a word, 'unsettled' for one the pool never answered. Resolved or rejected
 *  are one answer here: either sends the caller down its main-thread path, and a hang sends it
 *  nowhere. */
function fates(jobs: Promise<unknown>[]): Promise<string[]> {
  const sentinel = new Promise<string>((r) => setTimeout(() => r('unsettled'), 50));
  return Promise.all(jobs.map((p) => Promise.race([p.then(() => 'settled', () => 'settled'), sentinel])));
}

beforeEach(() => {
  failPost = () => false;
  constructFails = false;
  totalPosts = 0;
  posted.length = 0;
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('a pool that works', () => {
  it('warms one worker and grows only for concurrent jobs', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const pool = await loadPool();
    pool.warmPool(); pool.warmPool();
    expect(FakeWorker.all).toHaveLength(1);
    const jobs = Array.from({ length: 3 }, () => pool.runCandidateInPool({ state: tinyState(), config, region: null }));
    expect(FakeWorker.all).toHaveLength(3);
    while (posted.length) deliverOne();
    await Promise.all(jobs);
  });

  it('releases surplus idle workers while retaining one warm worker', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const pool = await loadPool();
    const jobs = Array.from({ length: 3 }, () => pool.runCandidateInPool({ state: tinyState(), config, region: null }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWorker.all.every(worker => !worker.terminated)).toBe(true);
    while (posted.length) deliverOne();
    await Promise.all(jobs);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWorker.all.map(worker => worker.terminated)).toEqual([false, true, true]);
  });

  it('retires the warm worker and settles its job if growing the pool fails', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const pool = await loadPool();
    const first = pool.runCandidateInPool({ state: tinyState(), config, region: null });
    constructFails = true;
    const second = pool.runCandidateInPool({ state: tinyState(), config, region: null });
    expect(await fates([first, second])).toEqual(['settled', 'settled']);
    expect(FakeWorker.all.every(worker => worker.terminated)).toBe(true);
  });

  it('drains its queue, one job per worker at a time, and sends each template once', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const jobs = Array.from({ length: 5 }, () => pool.runCandidateInPool({ state, config, region: null }));

    const workers = FakeWorker.all.length;
    expect(workers, 'the pool booted its slots').toBeGreaterThanOrEqual(1);
    expect(posted.length, 'and holds one job per worker').toBe(Math.min(workers, jobs.length));

    let carriedTemplate = 0;
    let drained = 0;
    while (posted.length) {
      if (posted[0]!.hasTemplate) carriedTemplate++;
      expect(deliverOne()).toBeNull();
      drained++;
    }
    expect(drained, 'every job reached a worker').toBe(jobs.length);
    expect(carriedTemplate, 'the template rides the first job each worker sees, and no other').toBe(workers);
    expect(await Promise.all(jobs), 'an answer with no run in it is a dropped candidate').toEqual(jobs.map(() => null));
    expect(pool.poolAvailable()).toBe(true);
  });

  it('resolves a job cancelled before a worker picked it up, without posting it', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const signal = { cancelled: false };
    // Four jobs outnumber the slots, so the fifth can only be waiting in the queue.
    const running = Array.from({ length: 4 }, () => pool.runCandidateInPool({ state, config, region: null }));
    const held = pool.runCandidateInPool({ state, config, region: null }, signal);
    signal.cancelled = true;

    while (posted.length) expect(deliverOne()).toBeNull();

    expect(await held).toBeNull();
    expect(await Promise.all(running)).toEqual(running.map(() => null));
    expect(totalPosts, 'the cancelled job never cost a worker').toBe(running.length);
  });
});

describe('a pool whose workers stop taking jobs', () => {
  it('settles the jobs it holds when a post fails from inside a worker answer', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const jobs = Array.from({ length: 6 }, () => pool.runCandidateInPool({ state, config, region: null }));
    jobs.forEach((p) => void p.catch(() => {}));

    const dispatched = posted.length;
    expect(dispatched, 'the pool filled its slots').toBeGreaterThanOrEqual(1);
    expect(jobs.length, 'and left some queued').toBeGreaterThan(dispatched);

    // From here every post refuses, so the dispatch that runs INSIDE the worker's own message
    // handler is the one that fails.
    failPost = () => true;
    const escaped = deliverOne();

    expect(escaped, 'no failure escapes the message handler').toBeNull();
    expect(await fates(jobs)).toEqual(jobs.map(() => 'settled'));
    expect(pool.poolAvailable(), 'the pool is broken, so callers run on the main thread').toBe(false);
  });

  it('settles a job whose answer this thread could not deserialize, and keeps the slot', async () => {
    // Without a `messageerror` handler the slot still holds that job, so it takes no further work
    // and the caller waits forever instead of falling back to the main thread.
    const pool = await loadPool();
    const state = tinyState();
    const first = pool.runCandidateInPool({ state, config, region: null });
    void first.catch(() => {});
    expect(refuseOne(), 'no failure escapes the handler').toBeNull();
    expect(await fates([first])).toEqual(['settled']);
    await expect(first).rejects.toThrow();

    expect(pool.poolAvailable(), 'the worker itself is healthy').toBe(true);
    const second = pool.runCandidateInPool({ state, config, region: null });
    expect(posted.length, 'the freed slot took the next job').toBe(1);
    expect(deliverOne()).toBeNull();
    expect(await second).toBeNull();
  });

  it('settles them when the very first post fails', async () => {
    const pool = await loadPool();
    failPost = () => true;
    const state = tinyState();
    const jobs = Array.from({ length: 3 }, () => pool.runCandidateInPool({ state, config, region: null }));
    jobs.forEach((p) => void p.catch(() => {}));

    expect(await fates(jobs)).toEqual(jobs.map(() => 'settled'));
    expect(pool.poolAvailable()).toBe(false);
  });

  it('settles them when no worker can be constructed at all', async () => {
    const pool = await loadPool();
    constructFails = true;
    const jobs = [pool.runPreviewInPool(tinyState(), 'raise', {} as never)];
    jobs.forEach((p) => void p.catch(() => {}));

    expect(await fates(jobs)).toEqual(['settled']);
    expect(pool.poolAvailable()).toBe(false);
  });

  it('warms without a pool when the workers cannot be constructed', async () => {
    const pool = await loadPool();
    constructFails = true;
    expect(() => pool.warmPool()).not.toThrow();
    expect(pool.poolAvailable()).toBe(false);
  });
});
