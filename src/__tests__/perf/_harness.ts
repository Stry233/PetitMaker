/*
 * _harness.ts — the perf tier's measurement harness.
 *
 * The perf suites (`*.perf.test.ts`, this directory) time the app's operation layer — generation,
 * commands, indexes, codecs, geometry builders — as plain functions, no browser. They are SKIPPED
 * by default (the `PETIT_DUMP` harnesses' own gate pattern) and run with:
 *
 *   PETIT_PERF=1 npx vitest run --no-file-parallelism src/__tests__/perf
 *
 * `--no-file-parallelism` matters: numbers taken while sibling workers saturate the cores measure
 * the scheduler, not the code. Each suite writes `<suite>.json` into PETIT_PERF_OUT (default
 * /tmp/petit-perf), one BenchRecord per operation; `scripts` tooling folds two such directories
 * into a before/after table. Run outputs are not committed.
 *
 * METHODOLOGY. Each bench auto-calibrates: one untimed warmup pass, then enough samples to fill a
 * time budget (bounded both ways), reporting median/p95 — median for the headline (stable against
 * GC pauses), p95 for the stutter a user actually feels. An op that mutates its input takes a
 * `setup` callback, run untimed before every sample, so every sample measures the same work.
 */
import { afterAll } from 'vitest';

declare const process: { env: Record<string, string | undefined>; version: string };

export const PERF = process.env.PETIT_PERF === '1';

export interface BenchStats {
  n: number;
  min: number;
  p50: number;
  mean: number;
  p95: number;
  max: number;
}

export interface BenchRecord {
  /** `<suite>/<name>` is the cross-run join key, so names must stay stable across a code change. */
  name: string;
  stats: BenchStats;
  /** Work counters (cells laid, bytes coded…) so a time can be checked against what it did. */
  meta?: Record<string, number | string>;
}

export interface BenchOpts {
  /** Untimed warmup passes before sampling (default 1). */
  warmup?: number;
  /** Total sampling budget in ms; sample count is derived from the first timed pass. */
  budgetMs?: number;
  minSamples?: number;
  maxSamples?: number;
  /** Untimed, before every sample: rebuild whatever the op consumes or mutates. */
  setup?: () => void;
  meta?: Record<string, number | string>;
}

const DEFAULTS = { warmup: 1, budgetMs: 1200, minSamples: 5, maxSamples: 300 };

function stats(samples: number[]): BenchStats {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.round((s.length - 1) * p))]!;
  return {
    n: s.length,
    min: s[0]!,
    p50: q(0.5),
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p95: q(0.95),
    max: s[s.length - 1]!,
  };
}

const fmt = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(4));

export interface PerfSuite {
  bench(name: string, fn: () => unknown, opts?: BenchOpts): Promise<BenchStats>;
}

/**
 * One suite = one output file. Register in the suite module's top level (the `afterAll` writer
 * needs a vitest context), then call `s.bench(...)` from inside `it` blocks.
 */
export function perfSuite(suite: string): PerfSuite {
  const records: BenchRecord[] = [];

  afterAll(async () => {
    if (!PERF || records.length === 0) return;
    // @ts-ignore dev-only harness — node builtins are untyped in this tree (no @types/node)
    const { mkdirSync, writeFileSync } = await import('node:fs');
    // @ts-ignore dev-only harness — node builtins are untyped in this tree (no @types/node)
    const { join } = await import('node:path');
    // @ts-ignore dev-only harness — node builtins are untyped in this tree (no @types/node)
    const os = await import('node:os');
    const dir = process.env.PETIT_PERF_OUT ?? '/tmp/petit-perf';
    mkdirSync(dir, { recursive: true });
    const out = {
      suite,
      date: new Date().toISOString(),
      node: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      records,
    };
    writeFileSync(join(dir, `${suite}.json`), JSON.stringify(out, null, 1));
    console.log(`[perf] ${suite}: ${records.length} benches -> ${join(dir, `${suite}.json`)}`);
  });

  async function bench(name: string, fn: () => unknown, opts: BenchOpts = {}): Promise<BenchStats> {
    const o = { ...DEFAULTS, ...opts };
    const run = async () => {
      opts.setup?.();
      const t0 = performance.now();
      await fn();
      return performance.now() - t0;
    };
    for (let i = 0; i < o.warmup; i++) await run();
    const first = await run();
    const target = Math.max(o.minSamples, Math.min(o.maxSamples, Math.ceil(o.budgetMs / Math.max(first, 0.001))));
    const samples: number[] = [first];
    while (samples.length < target) samples.push(await run());
    const st = stats(samples);
    records.push({ name, stats: st, ...(o.meta ? { meta: o.meta } : {}) });
    console.log(
      `[perf] ${suite}/${name}: p50 ${fmt(st.p50)}ms  p95 ${fmt(st.p95)}ms  (n=${st.n})`,
    );
    return st;
  }

  return { bench };
}
