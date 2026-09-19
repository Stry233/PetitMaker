// GOLDEN-HASH guard: the generator promises same (seed, config) → identical map, but nothing
// pinned that promise ACROSS COMMITS — design-quality.test.ts's determinism probe only compares
// two runs within the same test process, so a refactor that reorders RNG calls produces a
// different-but-still-internally-deterministic map and no test notices. That silently breaks
// every recipe number a player has written down: a seed retyped into the shelf re-generates,
// and only the seed's OUTPUT identity makes that reproduce their map.
//
// This file hashes the OUTCOME of a small fixed (seed, config) matrix run through the REAL
// pipeline (`generateTerrain`, the same entry the Generate shelf calls) and pins the hash as a
// literal. A failure here — any one of them included — means a change ALTERED WHAT A SEED
// PRODUCES:
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
 *  (road tiles included — a road IS a PlacedObject) sorted by
 *  its OWN serialized fields rather than by id or Map insertion order. Object ids are minted from
 *  `Date.now()`/`Math.random()` (core/model/object-id.ts:generateObjectId) and are never reproducible
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

/** One run through the shelf's own entry — one stroke group, one undo. */
function run(config: GenerateConfig): GridState {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  exec.runSilently(() => generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry()));
  exec.commitStrokeGroup(exec.getUndoStackSize());
  return state;
}

describe('golden hash: what a seed produces is pinned across commits', () => {
  // The planet across a few seeds at the shelf's default richness — the matrix a saved "recipe
  // number" most commonly is — plus both ends of the richness axis on one seed.
  it.each([
    ['mixed seed 4', { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 4, region: null, richness: 0.7 } as GenerateConfig, '5f6c4378a5cd4d8868cf7c26f0a0d2eea1cbcc61924743cd046fea4ff5b45c46'],
    ['mixed seed 11', { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 11, region: null, richness: 0.7 } as GenerateConfig, '6ab5e1c86466046b0d3637c2b5c845445249888ed10f4b4e344ad242afe6f991'],
    ['earth seed 42', { algorithm: 'designed', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed: 42, region: null, richness: 0.7 } as GenerateConfig, '1a96458db8a25dbb37ea7162e4b41e86813e60c011fdf8897d5600164d5f9c76'],
    ['garden town (richness 0) seed 4', { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 4, region: null, richness: 0 } as GenerateConfig, 'd39c8454dfbedb703f78ad51538b1ac2cd3e9369746ccb1522580d573def149c'],
    ['terraced planet (richness 1) seed 4', { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 4, region: null, richness: 1 } as GenerateConfig, '16b09ee2fb4c08f51c4abfb30ad4603462367766643995f4223a2c77b41f5c53'],
  ] as const)('%s', (_label, config, expected) => {
    expect(goldenHash(run(config))).toBe(expected);
  });

  it('maze algorithm seed 7', () => {
    const config: GenerateConfig = { algorithm: 'maze', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed: 7, region: null };
    expect(goldenHash(run(config))).toBe('234f9eb8953ac6616504ba88cde95eedfc226396915050c5d9c2ecaf3c46c676');
  });
});
