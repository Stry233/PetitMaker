/**
 * The pool settles every job it takes, whatever goes wrong with the workers.
 *
 * Every caller of the pool awaits it with a main-thread fallback ready behind a `catch`
 * (`candidates.ts:buildCandidate`, `macros/run.ts:applyMacroAsync`, `macros/runtime/preview.ts`), so a
 * rejection costs a frame and a hang costs the feature: a generate card that never arrives, a
 * macro press that never lands. `Worker` does not exist in this environment, so the pool is driven
 * here by a fake one whose `postMessage` can be made to fail the way a real one does (a payload
 * structured-clone refuses, a worker already gone), and each test asserts the same thing — that
 * every job settled, one way or the other.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CellZone } from '../../../../core/game/zones';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { encodeCells } from '../../../../core/model/grid-wire';
import type { WireTransferPreview } from '../../../../tools/generation/run/candidate-wire';
import type { RuleDispatcher } from '../../../../core/model/rule-dispatcher';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import type { AnnotationsState } from '../../../../core/model/annotations';

type Pool = typeof import('../../../../tools/generation/run/candidate-pool');

interface Posted { worker: FakeWorker; id: number; kind: string; hasTemplate: boolean; templates: string[]; rules?: string; annotations?: AnnotationsState }

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
    const { id, kind, grid, templates, rules: set, annotations } = msg as {
      id: number; kind: string; grid: { template?: unknown }; templates?: MapTemplate[]; rules?: string; annotations?: AnnotationsState;
    };
    if (failPost(id)) throw new Error('DataCloneError: could not be cloned');
    totalPosts++;
    posted.push({
      worker: this, id, kind, hasTemplate: grid.template !== undefined, templates: (templates ?? []).map((t) => t.id),
      ...(set ? { rules: set } : {}),
      ...(annotations ? { annotations } : {}),
    });
  }

  terminate(): void { this.terminated = true; }
}

/** Lets the pool act on an answer: it settles the job and dispatches the next one a few
 *  microtasks after the worker's message. */
async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Hand one queued question its answer, the way a worker does, and let the pool act on it. Returns
 *  whatever escaped the message handler, which for a healthy pool is nothing. */
async function deliverOne(answer: Record<string, unknown> = {}): Promise<unknown> {
  const next = posted.shift();
  if (!next) throw new Error('nothing was posted');
  try {
    next.worker.onmessage?.({ data: { id: next.id, ok: true, ...answer } } as MessageEvent);
  } catch (err) {
    return err;
  }
  await settled();
  return null;
}

/** An answer this thread cannot deserialize, the way a browser reports one. */
async function refuseOne(): Promise<unknown> {
  const next = posted.shift();
  if (!next) throw new Error('nothing was posted');
  try {
    next.worker.onmessageerror?.({ type: 'messageerror' });
  } catch (err) {
    return err;
  }
  await settled();
  return null;
}

/** A 2x2 planet: enough for the pool to encode a grid, and nothing crosses the wire here anyway. */
function tinyState(): GridState {
  const template: MapTemplate = {
    id: 'pool-test', name: { en: 'pool-test' }, width: 2, height: 2,
    zones: [[CellZone.Grass, CellZone.Grass], [CellZone.Grass, CellZone.Grass]],
    landmarks: [{ id: ANCHOR_LANDMARK.id, x: 0.5, y: 0.5, width: 1, height: 1, color: '#E2E8F0' }],
  };
  return {
    template,
    cells: [
      [{ zone: CellZone.Grass, terrain: null }, { zone: CellZone.Grass, terrain: null }],
      [{ zone: CellZone.Grass, terrain: null }, { zone: CellZone.Grass, terrain: null }],
    ],
    objects: new Map(),
    objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
}

const config: GenerateConfig = defaultConfig('designed', { maxElevation: 4, seed: 1, richness: 1 });

/** The pool keeps its slots and its broken flag at module scope, so each test gets its own copy. */
async function loadPool(): Promise<Pool> {
  vi.resetModules();
  rulesModule = await import('../../../../rules');
  rules = rulesModule.createDefaultRegistry();
  return import('../../../../tools/generation/run/candidate-pool');
}

/** The rules module of the graph `loadPool` loaded, and its default registry: the pool names a
 *  registry's set by that graph's own class. */
let rulesModule: typeof import('../../../../rules');
let rules: RuleDispatcher;

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
    const jobs = Array.from({ length: 3 }, () => pool.runCandidateInPool({ state: tinyState(), config, region: null, rules }));
    expect(FakeWorker.all).toHaveLength(3);
    while (posted.length) await deliverOne();
    await Promise.all(jobs);
  });

  it('releases surplus idle workers while retaining one warm worker', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const pool = await loadPool();
    const jobs = Array.from({ length: 3 }, () => pool.runCandidateInPool({ state: tinyState(), config, region: null, rules }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWorker.all.every(worker => !worker.terminated)).toBe(true);
    while (posted.length) await deliverOne();
    await Promise.all(jobs);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWorker.all.map(worker => worker.terminated)).toEqual([false, true, true]);
  });

  it('retires the warm worker and settles its job if growing the pool fails', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const pool = await loadPool();
    const first = pool.runCandidateInPool({ state: tinyState(), config, region: null, rules });
    constructFails = true;
    const second = pool.runCandidateInPool({ state: tinyState(), config, region: null, rules });
    expect(await fates([first, second])).toEqual(['settled', 'settled']);
    expect(FakeWorker.all.every(worker => worker.terminated)).toBe(true);
  });

  it('drains its queue, one job per worker at a time, and sends each template once', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const jobs = Array.from({ length: 5 }, () => pool.runCandidateInPool({ state, config, region: null, rules }));

    const workers = FakeWorker.all.length;
    expect(workers, 'the pool booted its slots').toBeGreaterThanOrEqual(1);
    expect(posted.length, 'and holds one job per worker').toBe(Math.min(workers, jobs.length));

    let carriedTemplate = 0;
    let drained = 0;
    while (posted.length) {
      if (posted[0]!.hasTemplate) carriedTemplate++;
      expect(await deliverOne()).toBeNull();
      drained++;
    }
    expect(drained, 'every job reached a worker').toBe(jobs.length);
    expect(carriedTemplate, 'the template rides the first job each worker sees, and no other').toBe(workers);
    expect(await Promise.all(jobs), 'an answer with no run in it is a dropped candidate').toEqual(jobs.map(() => null));
    expect(pool.poolAvailable()).toBe(true);
  });

  it('resolves a job aborted while it waits at once, without posting it', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const controller = new AbortController();
    const { signal } = controller;
    // Four jobs outnumber the slots, so the fifth can only be waiting in the queue.
    const running = Array.from({ length: 4 }, () => pool.runCandidateInPool({ state, config, region: null, rules }));
    const held = pool.runCandidateInPool({ state, config, region: null, rules }, signal);
    controller.abort();
    expect(await held, 'it settles at once, before any worker frees').toBeNull();

    while (posted.length) expect(await deliverOne()).toBeNull();

    expect(await Promise.all(running)).toEqual(running.map(() => null));
    expect(totalPosts, 'the cancelled job never cost a worker').toBe(running.length);
  });
});

describe('a carry preview in the pool', () => {
  /** A worker's carry answer for `state`: its grid back on the wire and a one-cell loss. */
  const answerFor = (state: GridState): { preview: WireTransferPreview } => ({
    preview: {
      grid: { wire: encodeCells(state.cells, 2, 2), objects: [], lockedLayers: [], cellsVersion: 3, objectsVersion: 4 },
      dropped: [{ x: -1, y: 0, grid: 'terrain' }], moved: { cells: 1, objects: 0 }, droppedCounts: { cells: 1, objects: 0 },
    },
  });
  const planet = (id: string): MapTemplate => ({ ...tinyState().template, id });

  it('runs ahead of waiting candidates, sends its destination once per worker, and comes back as a map', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
    const pool = await loadPool();
    const state = tinyState();
    const target = planet('pool-target');
    const cards = Array.from({ length: 2 }, () => pool.runCandidateInPool({ state, config, region: null, rules }));
    const first = pool.runTransferPreviewInPool(state, target);
    expect(posted.map((p) => p.kind), 'one worker, busy with the first card').toEqual(['candidate']);
    await deliverOne();
    expect(posted.map((p) => p.kind), 'the preview jumps the card that was waiting').toEqual(['transfer']);
    expect(posted[0]!.templates).toEqual([target.id]);
    await deliverOne(answerFor(state));
    const preview = await first;
    expect(preview?.state.template).toBe(target);
    expect(preview?.state.cellsVersion).toBe(3);
    expect(preview?.dropped).toEqual([{ x: -1, y: 0, grid: 'terrain' }]);
    expect(preview?.droppedCounts).toEqual({ cells: 1, objects: 0 });

    const again = pool.runTransferPreviewInPool(state, target);
    await deliverOne();
    expect(posted[0]!.kind).toBe('transfer');
    expect(posted[0]!.templates, 'the worker already holds the destination').toEqual([]);
    await deliverOne(answerFor(state));
    expect((await again)?.state.template).toBe(target);
    await Promise.all(cards);
  });

  it('sends nothing extra when the destination is the map\'s own planet', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const job = pool.runTransferPreviewInPool(state, state.template);
    expect(posted[0]).toMatchObject({ kind: 'transfer', hasTemplate: true, templates: [] });
    await deliverOne(answerFor(state));
    expect((await job)?.state.template).toBe(state.template);
  });

  it('sends the map\'s plan notes with the grid and revives the notes it is answered with', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const notes: AnnotationsState = {
      items: [{ kind: 'chip', id: 'c', x: 1, y: 1, tag: 'homes', size: 'm', color: '#ff0000' }], visible: false, locked: false,
    };
    state.annotations = notes;
    const job = pool.runTransferPreviewInPool(state, planet('pool-target'));
    expect(posted[0]!.annotations).toEqual(notes);
    const answer = answerFor(state);
    await deliverOne({ preview: { ...answer.preview, annotations: notes } });
    expect((await job)?.state.annotations).toEqual(notes);
  });

  it('resolves null without posting when cancelled while it waits', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
    const pool = await loadPool();
    const state = tinyState();
    const card = pool.runCandidateInPool({ state, config, region: null, rules });
    const controller = new AbortController();
    const { signal } = controller;
    const preview = pool.runTransferPreviewInPool(state, planet('pool-target'), signal);
    controller.abort();
    await deliverOne();
    expect(await preview).toBeNull();
    expect(posted).toHaveLength(0);
    expect(totalPosts).toBe(1);
    await card;
  });
});

describe('a pool whose workers stop taking jobs', () => {
  it('settles the jobs it holds when a post fails from inside a worker answer', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const jobs = Array.from({ length: 6 }, () => pool.runCandidateInPool({ state, config, region: null, rules }));
    jobs.forEach((p) => void p.catch(() => {}));

    const dispatched = posted.length;
    expect(dispatched, 'the pool filled its slots').toBeGreaterThanOrEqual(1);
    expect(jobs.length, 'and left some queued').toBeGreaterThan(dispatched);

    // From here every post refuses, so the dispatch that runs inside the worker's own message
    // handler is the one that fails.
    failPost = () => true;
    const escaped = await deliverOne();

    expect(escaped, 'no failure escapes the message handler').toBeNull();
    expect(await fates(jobs)).toEqual(jobs.map(() => 'settled'));
    expect(pool.poolAvailable(), 'the pool is broken, so callers run on the main thread').toBe(false);
  });

  it('settles a job whose answer this thread could not deserialize, and keeps the slot', async () => {
    // Without a `messageerror` handler the slot still holds that job, so it takes no further work
    // and the caller waits forever instead of falling back to the main thread.
    const pool = await loadPool();
    const state = tinyState();
    const first = pool.runCandidateInPool({ state, config, region: null, rules });
    void first.catch(() => {});
    expect(await refuseOne(), 'no failure escapes the handler').toBeNull();
    expect(await fates([first])).toEqual(['settled']);
    await expect(first).rejects.toThrow();

    expect(pool.poolAvailable(), 'the worker itself is healthy').toBe(true);
    const second = pool.runCandidateInPool({ state, config, region: null, rules });
    expect(posted.length, 'the freed slot took the next job').toBe(1);
    expect(await deliverOne()).toBeNull();
    expect(await second).toBeNull();
  });

  it('settles the jobs it holds when a worker crashes', async () => {
    const pool = await loadPool();
    const state = tinyState();
    const jobs = Array.from({ length: 4 }, () => pool.runCandidateInPool({ state, config, region: null, rules }));
    jobs.forEach((p) => void p.catch(() => {}));
    posted[0]!.worker.onerror?.(new Error('worker crashed'));
    expect(await fates(jobs)).toEqual(jobs.map(() => 'settled'));
    await expect(jobs[0]).rejects.toBeInstanceOf(pool.PoolBroken);
    expect(pool.poolAvailable()).toBe(false);
    expect(FakeWorker.all.every((worker) => worker.terminated)).toBe(true);
  });

  it('settles them when the very first post fails', async () => {
    const pool = await loadPool();
    failPost = () => true;
    const state = tinyState();
    const jobs = Array.from({ length: 3 }, () => pool.runCandidateInPool({ state, config, region: null, rules }));
    jobs.forEach((p) => void p.catch(() => {}));

    expect(await fates(jobs)).toEqual(jobs.map(() => 'settled'));
    expect(pool.poolAvailable()).toBe(false);
  });

  it('settles them when no worker can be constructed at all', async () => {
    const pool = await loadPool();
    constructFails = true;
    const jobs = [pool.runPreviewInPool(tinyState(), 'raise', {} as never, rules)];
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

describe('a failed job and a broken pool', () => {
  it('rejects a job its worker failed with that job\'s own error and keeps the pool for the next', async () => {
    const pool = await loadPool();
    const { MacroRunnerUnavailable } = await import('../../../../tools/macros');
    const failed = pool.runPreviewInPool(tinyState(), 'raise', {} as never, rules);
    const next = posted.shift()!;
    next.worker.onmessage?.({ data: { id: next.id, ok: false, error: 'job threw' } } as MessageEvent);
    const err = await failed.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MacroRunnerUnavailable);
    expect(err).not.toBeInstanceOf(pool.PoolBroken);
    expect(pool.poolAvailable()).toBe(true);
    const again = pool.runPreviewInPool(tinyState(), 'raise', {} as never, rules);
    expect(posted).toHaveLength(1);
    expect(await deliverOne({ preview: { cells: [] } })).toBeNull();
    expect(await again).toEqual({ cells: [] });
  });

  it('rejects macro jobs as an unavailable runner once the pool is broken', async () => {
    const pool = await loadPool();
    const { MacroRunnerUnavailable } = await import('../../../../tools/macros');
    constructFails = true;
    await expect(pool.runPreviewInPool(tinyState(), 'raise', {} as never, rules)).rejects.toBeInstanceOf(MacroRunnerUnavailable);
    await expect(pool.runMacroBuildInPool(tinyState(), 'raise', {} as never, rules)).rejects.toBeInstanceOf(MacroRunnerUnavailable);
    await expect(pool.runCandidateInPool({ state: tinyState(), config, region: null, rules })).rejects.toBeInstanceOf(pool.PoolBroken);
  });
});

describe('the rule set a job carries', () => {
  it('names the asking map rule set, so a planet session is judged by its own rules', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const pool = await loadPool();
    const planet = rulesModule.createPlanetRegistry();
    const jobs = [
      pool.runCandidateInPool({ state: tinyState(), config, region: null, rules: planet }),
      pool.runPreviewInPool(tinyState(), 'raise', {} as never, planet),
      pool.runMacroBuildInPool(tinyState(), 'raise', {} as never, rules),
    ];
    await settled();
    expect(posted.map((p) => [p.kind, p.rules]).sort()).toEqual([['candidate', 'planet'], ['macro', 'default'], ['preview', 'planet']]);
    while (posted.length) await deliverOne({ preview: { cells: [] } });
    expect(await fates(jobs)).toEqual(['settled', 'settled', 'settled']);
  });

  it('sends nothing for a registry no worker can build, and the caller runs it in-process', async () => {
    const pool = await loadPool();
    const handBuilt = new rulesModule.RuleRegistry();
    const { MacroRunnerUnavailable } = await import('../../../../tools/macros');
    await expect(pool.runPreviewInPool(tinyState(), 'raise', {} as never, handBuilt)).rejects.not.toBeInstanceOf(MacroRunnerUnavailable);
    await expect(pool.runCandidateInPool({ state: tinyState(), config, region: null, rules: handBuilt })).rejects.not.toBeInstanceOf(pool.PoolBroken);
    expect(totalPosts).toBe(0);
    expect(pool.poolAvailable()).toBe(true);
  });
});
