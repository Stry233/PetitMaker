/**
 * Text is one layer on the ground it stands on. Laying a glyph ring by ring would give it a layer-1
 * skirt and leave parts too thin for a second ring as holes; painting tier 1 over a mountain would
 * carve the plateau instead of writing on it.
 */
import { describe, it, expect } from 'vitest';
import { TerrainType, type Command, type GridState, type ValidationResult } from '../../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import type { StencilPlan } from '../../../../tools/generation/recipe';
import type { Stencil } from '../../../../tools/generation/stencil/stencil';
import { ELEVATION_MAX } from '../../../../core/game/profile';

const exec = (state: GridState) => makeExecutor(state);

/** The text mode's terrain fill, laid through the plan entry the generator runs. */
const layTerrain = (
  state: GridState, placement: Pick<StencilPlan, 'origin' | 'stencil' | 'allow'>, terrain: TerrainType,
  execute: (cmd: Command) => ValidationResult,
) => runStencilPlan(state, { read: 'shape', fill: { kind: 'terrain', terrain }, ...placement }, ELEVATION_MAX, execute);

/** A stencil from an ASCII picture: '#' is covered, '.' is not. */
function stencilOf(rows: string[]): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  const color = new Uint32Array(width * height);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { coverage[y * width + x] = ch === '.' ? 0 : 255; }));
  return { width, height, coverage, color };
}

/** A solid block, whose interior ring-by-ring terracing would climb. */
const slab = (n: number): Stencil => stencilOf(Array.from({ length: n }, () => '#'.repeat(n)));

function tiers(state: GridState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of state.cells) {
    for (const cell of row) {
      const t = cell.terrain;
      if (t?.type === TerrainType.Mountain) counts.set(t.elevation, (counts.get(t.elevation) ?? 0) + 1);
    }
  }
  return counts;
}

function plateau(state: GridState, rect: { x0: number; y0: number; w: number; h: number }, elevation: number): void {
  const { x0, y0, w, h } = rect;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setTerrain(state, x, y, TerrainType.Mountain, elevation);
}

describe('text stands one layer above the surface it is written on', () => {
  it('lays ONE tier, so there is no skirt around the letter', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layTerrain(state, { origin: { x: 6, y: 6 }, stencil: slab(9) }, TerrainType.Mountain, (c) => e.execute(c));
    expect([...tiers(state).keys()]).toEqual([1]);
    expect(res.base).toBe(0);
    expect(whole.commit()).toEqual([]);
  });

  it('writes ON a raised region rather than carving into it', () => {
    const state = makeState(24, 24);
    plateau(state, { x0: 4, y0: 4, w: 14, h: 14 }, 2);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layTerrain(state, { origin: { x: 8, y: 8 }, stencil: slab(6) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(res.base).toBe(2);
    expect(state.cells[10]![10]!.terrain?.elevation).toBe(3);
    expect(whole.commit()).toEqual([]);
  });

  it('leaves no hollow gap: every covered cell it may write is written', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    // A 1-cell stem, a 2-cell bar and a wide blob, which ring-by-ring terracing lays at three tiers.
    const stencil = stencilOf([
      '#.####',
      '#.####',
      '#.####',
      '######',
      '#.....',
      '#.....',
    ]);
    const res = layTerrain(state, { origin: { x: 6, y: 6 }, stencil }, TerrainType.Mountain, (c) => e.execute(c));
    let covered = 0;
    for (let y = 0; y < stencil.height; y++) {
      for (let x = 0; x < stencil.width; x++) {
        if (stencil.coverage[y * stencil.width + x]! < 128) continue;
        covered++;
        expect(state.cells[6 + y]![6 + x]!.terrain?.elevation).toBe(1);
      }
    }
    expect(res.placed).toBe(covered);
    expect(res.skipped).toBe(0);
    expect(whole.commit()).toEqual([]);
  });

  it('takes the majority surface and skips the cells standing on another', () => {
    const state = makeState(24, 24);
    plateau(state, { x0: 4, y0: 4, w: 16, h: 16 }, 1);
    // A ground shelf under the right-hand three columns of the glyph.
    for (let y = 4; y < 20; y++) for (let x = 13; x < 20; x++) state.cells[y]![x]!.terrain = null;
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layTerrain(state, { origin: { x: 8, y: 8 }, stencil: slab(8) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(res.base).toBe(1);
    expect(res.offBase).toBe(8 * 3);              // the three columns on the ground shelf
    expect(state.cells[10]![10]!.terrain?.elevation).toBe(2);
    expect(state.cells[10]![13]!.terrain).toBeNull();
    expect(whole.commit()).toEqual([]);
  });

  it('refuses to write where the surface cannot carry the layer', () => {
    // A rim cell raised to 4 beside the drop to the ground would break V-MTN-03, which runs after
    // the stroke, so an unchecked lay would revert the whole run.
    const state = makeState(24, 24);
    plateau(state, { x0: 8, y0: 8, w: 8, h: 8 }, 3);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layTerrain(state, { origin: { x: 8, y: 8 }, stencil: slab(8) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(res.base).toBe(3);
    expect(res.placed).toBe(6 * 6);              // the interior; the rim is left standing at 3
    // Reaching the edge of the ground is counted apart from crossing a step.
    expect(res.unsupported).toBe(8 * 8 - 6 * 6);
    expect(res.offBase).toBe(0);
    expect(whole.commit()).toEqual([]);
  });

  it('says a word had nowhere above to go, rather than writing nothing quietly', () => {
    const state = makeState(24, 24);
    plateau(state, { x0: 4, y0: 4, w: 16, h: 16 }, ELEVATION_MAX);
    const e = exec(state);
    const res = layTerrain(state, { origin: { x: 8, y: 8 }, stencil: slab(6) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(res.base).toBe(ELEVATION_MAX);
    expect(res.atCeiling).toBe(6 * 6);
    expect(res.placed).toBe(0);
    expect(res.offBase).toBe(0);
    expect(res.unsupported).toBe(0);
  });

  it('steps over a pond rather than painting a hill into it', () => {
    const state = makeState(24, 24);
    for (let y = 9; y < 12; y++) for (let x = 9; x < 12; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const e = exec(state);
    const whole = e.beginStroke();
    const res = layTerrain(state, { origin: { x: 6, y: 6 }, stencil: slab(9) }, TerrainType.Mountain, (c) => e.execute(c));
    expect(res.base).toBe(0);
    expect(res.offBase).toBe(9);                          // the pond's cells
    expect(state.cells[10]![10]!.terrain?.type).toBe(TerrainType.Water);
    expect(state.cells[7]![7]!.terrain?.elevation).toBe(1);
    expect(whole.commit()).toEqual([]);
  });

  it('sinks water at the surface itself, where a body has no exposed face', () => {
    const state = makeState(24, 24);
    const e = exec(state);
    const whole = e.beginStroke();
    layTerrain(state, { origin: { x: 8, y: 8 }, stencil: slab(4) }, TerrainType.Water, (c) => e.execute(c));
    expect(state.cells[9]![9]!.terrain?.type).toBe(TerrainType.Water);
    expect(state.cells[9]![9]!.terrain?.elevation).toBe(0);
    expect(whole.commit()).toEqual([]);
  });

  it('is deterministic: the same glyph on the same ground twice over', () => {
    const run = (): number[] => {
      const state = makeState(24, 24);
      const e = exec(state);
      layTerrain(state, { origin: { x: 6, y: 6 }, stencil: slab(7) }, TerrainType.Mountain, (c) => e.execute(c));
      return state.cells.flatMap((row) => row.map((c) => c.terrain?.elevation ?? -1));
    };
    expect(run()).toEqual(run());
  });
});
