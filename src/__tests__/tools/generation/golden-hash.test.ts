// GOLDEN-HASH guard: the generator promises same (seed, config) → identical map, but nothing
// pinned that promise ACROSS COMMITS — design-quality.test.ts's determinism probe only compares
// two runs within the same test process, so a refactor that reorders RNG calls produces a
// different-but-still-internally-deterministic map and no test notices. That silently breaks
// every recipe number a player has written down: a seed retyped into the shelf re-generates,
// and only the seed's OUTPUT identity makes that reproduce their map.
//
// This file hashes the OUTCOME of a small fixed (seed, config) matrix run through the REAL
// pipeline (generateTerrain + populate, the same entry App.tsx's Generate shelf calls) and pins
// the hash as a literal. A failure here — ANY of the five, one included — means a change ALTERED
// WHAT A SEED PRODUCES:
//   - INTENTIONAL (a tuning knob, a new catalog item: the generator picks from the live catalog,
//     so an addition changes every seed's output by design) → regenerate the literals (run this
//     file, copy each test's printed actual hash — or log EXPECTED vs actual with a temporary
//     console.log in mapHash) and update them IN THE SAME COMMIT, saying so in the message.
//   - UNINTENTIONAL → the change broke recipe stability; find the RNG-order or logic drift.
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:crypto is untyped in this project (no @types/node); test-only hashing.
import { createHash } from 'node:crypto';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { toGenConfig } from '../../../tools/generation';
import { populate } from '../../../tools/generation/placement';
import { getCell } from '../../../core/model/grid-model';
import { roadLookup } from '../../../state/object-index';
import type { Command, EditorEvents, GenerateConfig, GridState } from '../../../core/model/types';

const SIZE = 64;

/** Canonical per-cell token: terrain type/elevation/corners/patch fields, the exact set the
 *  generator's terrain pass can change. Zone is deliberately excluded — it comes from the map
 *  TEMPLATE, not the seed, so it never varies across a (seed, config) run and would only dilute
 *  a real mismatch. `.` marks a bare (grass) cell so raster position stays implicit in row order. */
function cellToken(state: GridState, x: number, y: number): string {
  const t = getCell(state.cells, x, y)?.terrain;
  if (!t) return '.';
  const corners = t.corners ? t.corners.join(',') : '';
  return `${t.type}:${t.elevation}:${corners}:${t.patchOnly ? 1 : 0}:${t.patchBase ?? ''}`;
}

/** Canonical serialization of a generated map: cells in raster order, then every placed object
 *  (road tiles included — a road IS a PlacedObject, `catalogId.startsWith('road')`) sorted by
 *  its OWN serialized fields rather than by id or Map insertion order. Object ids are minted from
 *  `Date.now()`/`Math.random()` (tools/utils.ts:generateObjectId) and are never reproducible
 *  across runs, so they're excluded on purpose; sorting by the full per-object string (rather
 *  than a shorter key) gives a total order even when two objects tie on catalogId+position (a
 *  coating road tile under a building, say) without losing either from the digest. */
export function canonicalSerialize(state: GridState, w = SIZE, h = SIZE): string {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) row.push(cellToken(state, x, y));
    rows.push(row.join('|'));
  }
  const objectRows: string[] = [];
  for (const o of state.objects.values()) {
    const corners = o.corners ? o.corners.join(',') : '';
    objectRows.push(`${o.catalogId}:${o.position.x},${o.position.y}:${o.rotation}:${o.elevation}:${corners}:${o.patchOnly ? 1 : 0}:${o.spanLength ?? ''}:${o.locked ? 1 : 0}`);
  }
  objectRows.sort();
  return `${rows.join('\n')}\n---\n${objectRows.join('\n')}`;
}

export function goldenHash(state: GridState, w = SIZE, h = SIZE): string {
  return createHash('sha256').update(canonicalSerialize(state, w, h)).digest('hex');
}

/** Runs the same real pipeline `design-quality.test.ts` drives: generateTerrain (dispatches on
 *  config.algorithm) then, for the 'random' algorithm, populate() over its ZonePlan — one
 *  stroke group, one undo, exactly what App's Generate shelf does. */
function run(config: GenerateConfig): GridState {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  exec.runSilently(() => {
    const r = generateTerrain(config, state, (c: Command) => exec.execute(c));
    if (config.algorithm !== 'maze') void populate(toGenConfig(config), state, (c: Command) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
  });
  exec.commitStrokeGroup(exec.getUndoStackSize());
  return state;
}

describe('golden hash: what a seed produces is pinned across commits', () => {
  // Default recipe (naturalness 1, the organic style) across a few seeds — the matrix a saved
  // "recipe number" most commonly is.
  it.each([
    ['mixed seed 4', { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 4, region: null } as GenerateConfig, '78eef0297d334b7efa1d59cdd322c969d3acd1ab84d76f0267e47e39c5e052aa'],
    ['mixed seed 11', { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 11, region: null } as GenerateConfig, 'c3be76a2058c8572d7ff82a07c1fd79ab7c74eab6b0dc7f769f1facb31d1442f'],
    ['earth seed 42', { algorithm: 'random', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed: 42, region: null } as GenerateConfig, 'c4e4020f53a29c7e7a5809283ee5fbd0e39c6dcad6166f9e2c2e39b5d69ba569'],
  ] as const)('%s', (_label, config, expected) => {
    expect(goldenHash(run(config))).toBe(expected);
  });

  it('rectilinear style (naturalness 0) seed 4', () => {
    const config: GenerateConfig = { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 4, region: null, naturalness: 0 };
    expect(goldenHash(run(config))).toBe('f49ca68a61e59cab07752279ca69320ebb32cd63c9438e388d7c8c0eeeb7c5ad');
  });

  it('maze algorithm seed 7', () => {
    const config: GenerateConfig = { algorithm: 'maze', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed: 7, region: null };
    expect(goldenHash(run(config))).toBe('234f9eb8953ac6616504ba88cde95eedfc226396915050c5d9c2ecaf3c46c676');
  });
});
