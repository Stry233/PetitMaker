// DEV harness, not a test: times the generation cases end to end on the real hexia template and
// prints a per-phase table. Skipped by default — run with PETIT_PERF=1.
import { describe, it } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { RuleRegistry } from '../../rules/registry';
import { createDefaultRegistry } from '../../rules/index';
import { createGrid, createPlazaObject } from '../../core/model/grid-model';
import { decodeCells, encodeCells } from '../../core/model/grid-wire';
import { roadLookup } from '../../state/object-index';
import { getMapTemplate } from '../../config/maps';
import * as scratch from '../../tools/macros/scratch';
import {
  clearGenerated, generateCandidate, generateMap, __resetCandidateCache, type Candidate,
} from '../../kit/operations/generate';
import type { KitContext } from '../../kit/context';
import type { EditorEvents, GenerateConfig, GridState, MacroCoord, PlacedObject } from '../../core/model/types';

// @ts-ignore dev-only harness — process.env via globalThis (no @types/node)
const PERF = Boolean((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PETIT_PERF);

function hexiaKit(): KitContext {
  const template = getMapTemplate('hexia');
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  const state: GridState = { template, cells, objects, lockedLayers: new Set() };
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

const config = (seed: number): GenerateConfig => ({
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed, region: null,
  richness: 1,
});

interface Counters {
  execute: number; executeMs: number;
  commit: number; commitMs: number;
  pre: number; preMs: number;
  post: number; postMs: number;
  collapse: number; collapseMs: number;
}

let c: Counters;
function reset(): void {
  c = {
    execute: 0, executeMs: 0, commit: 0, commitMs: 0,
    pre: 0, preMs: 0, post: 0, postMs: 0, collapse: 0, collapseMs: 0,
  };
}
reset();

function instrument(): void {
  const exec = CommandExecutor.prototype.execute;
  CommandExecutor.prototype.execute = function (cmd) {
    const t = performance.now();
    try { return exec.call(this, cmd); } finally { c.execute++; c.executeMs += performance.now() - t; }
  };
  const commit = CommandExecutor.prototype.commitStroke;
  CommandExecutor.prototype.commitStroke = function (n, opts) {
    const t = performance.now();
    try { return commit.call(this, n, opts); } finally { c.commit++; c.commitMs += performance.now() - t; }
  };
  const collapse = CommandExecutor.prototype.collapseHistory;
  CommandExecutor.prototype.collapseHistory = function (n) {
    const t = performance.now();
    try { return collapse.call(this, n); } finally { c.collapse++; c.collapseMs += performance.now() - t; }
  };
  const pre = RuleRegistry.prototype.validatePreCommand;
  RuleRegistry.prototype.validatePreCommand = function (cmd, state) {
    const t = performance.now();
    try { return pre.call(this, cmd, state); } finally { c.pre++; c.preMs += performance.now() - t; }
  };
  const post = RuleRegistry.prototype.validatePostStroke;
  RuleRegistry.prototype.validatePostStroke = function (state, opts) {
    const t = performance.now();
    try { return post.call(this, state, opts); } finally { c.post++; c.postMs += performance.now() - t; }
  };
}

const rows: string[] = [];
function row(label: string, ms: number): void {
  rows.push([
    label.padEnd(42),
    `${ms.toFixed(0).padStart(7)}ms`,
    `cmds ${String(c.execute).padStart(6)}`,
    `exec ${c.executeMs.toFixed(0).padStart(5)}ms`,
    `commit ${c.commitMs.toFixed(0).padStart(5)}ms`,
    `pre ${String(c.pre).padStart(6)}/${c.preMs.toFixed(0).padStart(4)}ms`,
    `post ${String(c.post).padStart(4)}/${c.postMs.toFixed(0).padStart(4)}ms`,
    `collapse ${c.collapseMs.toFixed(0).padStart(4)}ms`,
  ].join('  '));
  reset();
}

async function timed(label: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  reset();
  const t = performance.now();
  await fn();
  row(label, performance.now() - t);
}

describe.runIf(PERF)('GENERATE perf', () => {
  it('times each case', async () => {
    instrument();
    const region: MacroCoord[] = [];
    for (let y = 40; y < 70; y++) for (let x = 40; x < 70; x++) region.push({ x, y });

    // (a) fresh generate on an empty map, no candidate offered.
    __resetCandidateCache();
    let kit = hexiaKit();
    await timed('a. fresh generate (empty map, no card)', () => generateMap(kit, { config: config(101), region: null }));
    const bigMap = kit.state;

    // (b) candidate click with a WARM cache: the build, then the replay.
    __resetCandidateCache();
    kit = hexiaKit();
    let cand: Candidate | null = null;
    await timed('b1. build candidate (cold, main thread)', async () => { cand = await generateCandidate(kit, { config: config(202), region: null }); });
    await timed('b2. LAND it (warm cache, replay)', () => generateMap(kit, { config: config(202), region: null, candidate: cand }));

    // (c) STALE candidate: built on the empty map, landed over an island.
    __resetCandidateCache();
    kit = hexiaKit();
    const stale = await generateCandidate(kit, { config: config(303), region: null });
    const first = await generateCandidate(kit, { config: config(304), region: null });
    await generateMap(kit, { config: config(304), region: null, candidate: first });
    await timed('c. land a STALE card (rebuild + land)', () => generateMap(kit, { config: config(303), region: null, candidate: stale }));

    // (d) clear the map, then generate again: once from a seed nothing was built for, and once
    // from a card the shelf is already holding (which is what a visitor's click actually is).
    const held = await generateCandidate(kit, { config: config(306), region: null });
    await timed('d1. clear the last run', () => clearGenerated(kit, { region: null }));
    await timed('d2. new seed after clear (must build)', () => generateMap(kit, { config: config(305), region: null }));
    await timed('d3. clear, then a card already on the shelf', async () => {
      clearGenerated(kit, { region: null });
      await generateMap(kit, { config: config(306), region: null, candidate: held });
    });

    // (e) region-scoped run on a fresh map.
    __resetCandidateCache();
    kit = hexiaKit();
    await timed('e. region-scoped generate (30x30)', () => generateMap(kit, { config: config(404), region }));

    // (f) the candidate ROW: seven builds.
    __resetCandidateCache();
    kit = hexiaKit();
    await timed('f1. batch of 7 candidates (cold)', () => Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((s) => generateCandidate(kit, { config: config(500 + s), region: null })),
    ));
    await timed('f2. the same 7 again (all cache hits)', () => Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((s) => generateCandidate(kit, { config: config(500 + s), region: null })),
    ));

    // The fingerprint, on its own: every candidate and every land pays one.
    const t = performance.now();
    for (let i = 0; i < 20; i++) scratch.mapFingerprint(bigMap);
    rows.push(`mapFingerprint (generated hexia)          ${((performance.now() - t) / 20).toFixed(2)}ms each`);

    // What a worker's ANSWER costs the main thread: the grid as a structured clone (what the pool
    // hands back today) against the wire buffer the outbound leg already uses.
    const plain = { cells: bigMap.cells, objects: [...bigMap.objects.values()] };
    const t2 = performance.now();
    for (let i = 0; i < 10; i++) structuredClone(plain);
    rows.push(`structuredClone(grid) [worker answer]     ${((performance.now() - t2) / 10).toFixed(2)}ms each`);
    const cmds = (await generateCandidate(kit, { config: config(202), region: null }))?.commands ?? [];
    const t4 = performance.now();
    for (let i = 0; i < 10; i++) structuredClone(cmds);
    rows.push(`structuredClone(${String(cmds.length).padStart(4)} commands)            ${((performance.now() - t4) / 10).toFixed(2)}ms each`);
    const t3 = performance.now();
    for (let i = 0; i < 10; i++) {
      const w = encodeCells(bigMap.cells, bigMap.template.width, bigMap.template.height);
      decodeCells({ ...w, buffer: structuredClone(w.buffer) });
      structuredClone([...bigMap.objects.values()]);
    }
    rows.push(`encode+clone+decode [wire]                ${((performance.now() - t3) / 10).toFixed(2)}ms each`);

    // eslint-disable-next-line no-console
    console.log(`\n${rows.join('\n')}\n`);
  }, 900_000);
});
