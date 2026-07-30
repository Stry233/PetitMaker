import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { TerrainType, type EditorEvents, type GenerateConfig } from '../../../core/model/types';
import { cutBackingByCorner } from '../../../core/edge-cut/cut-backing';

const SIZE = 80;
function gen(seed: number) {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const config: GenerateConfig = { algorithm: 'random', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed, region: null, relief: 0.7, settlement: 0, nature: 0 };
  const start = exec.getUndoStackSize();
  exec.runSilently(() => generateTerrain(config, state, (c) => exec.execute(c)));
  const postViol = exec.commitStrokeGroup(start).length;
  let mountains = 0, trimmed = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = state.cells[y]![x]!.terrain;
    if (t?.type === TerrainType.Mountain) mountains++;
    if (t?.corners && !t.corners.every((c) => c === 'square')) trimmed++;
  }
  return { state, postViol, mountains, trimmed };
}

describe('generation edge-cut', () => {
  it('cuts SOME terrain corners (the jagged tips/steps) but not all, and stays rule-clean (round + rect seeds)', () => {
    for (const seed of [7, 13, 42, 99]) { // 13 → rect bevel, others → round (mode is seed-derived)
      const { postViol, mountains, trimmed } = gen(seed);
      expect(postViol, `seed ${seed} rule-clean`).toBe(0);
      expect(trimmed, `seed ${seed} some corners trimmed`).toBeGreaterThan(0);
      expect(trimmed, `seed ${seed} not every cell trimmed (interiors/straight edges stay square)`).toBeLessThan(mountains);
    }
  });
  it('a MOUNTAIN cut toward water is BACKED by that water — no unfilled gap (generic island rule)', () => {
    // The old "a mountain never cuts toward water" special case is gone: a mountain shore/island MAY round
    // toward water (the generic figure-rounds-out rule). The invariant is that such a cut REVEALS the water
    // (cut-backing fills the cut quadrant), never leaving a bare gap. The waterfall LIP still stays square.
    const edges: [number, number, number[]][] = [[1, 0, [1, 3]], [-1, 0, [0, 2]], [0, -1, [0, 1]], [0, 1, [2, 3]]];
    const isCut = (c?: string) => !!c && c !== 'square' && c !== 'empty';
    for (const seed of [1, 42, 200]) {
      const state = makeState(SIZE, SIZE);
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
      const config: GenerateConfig = { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed, region: null, relief: 0.6 };
      exec.runSilently(() => generateTerrain(config, state, (c) => exec.execute(c)));
      exec.commitStrokeGroup(exec.getUndoStackSize());
      let mtnTowardWaterUnbacked = 0, waterfallLipCut = 0;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const t = state.cells[y]![x]!.terrain;
        if (!t?.corners) continue;
        const nAt = (dx: number, dy: number) => state.cells[y + dy]?.[x + dx]?.terrain;
        const backs = t.type === TerrainType.Mountain ? cutBackingByCorner(t, t.elevation, nAt) : null;
        for (const [dx, dy, cs] of edges) {
          const n = nAt(dx, dy);
          if (t.type === TerrainType.Mountain && n?.type === TerrainType.Water) {
            // every mountain corner cut toward this water edge must be backed (water, or a lower step)
            for (const ci of cs) if (isCut(t.corners[ci]) && !backs![ci]) mtnTowardWaterUnbacked++;
          }
          // waterfall lip: elevated water must not round toward an open/empty drop
          if (t.type === TerrainType.Water && t.elevation >= 1 && (!n || n.type === TerrainType.None) && cs.some((ci) => isCut(t.corners![ci]))) waterfallLipCut++;
        }
      }
      expect(mtnTowardWaterUnbacked, `seed ${seed}: mountain cut toward water with no backing (a gap)`).toBe(0);
      expect(waterfallLipCut, `seed ${seed}: waterfall lip cut toward the drop`).toBe(0);
    }
  });
  it('edge-cut is elevation-independent — tier>=2 convex tips DO round (no height gate)', () => {
    // Cuttability is a 2D-silhouette property: a convex corner rounds regardless of its stack height, so
    // auto-trim and generation match the manual tool at every elevation (regression: a height gate once
    // suppressed any tier>=2 cut that revealed only ground). A ground-revealing cut is fine — the renderer
    // draws the surrounding ground/lower step behind it (verified by the water-backing test above + a
    // generated-terrain render). Here we just confirm tall convex tips are never held square.
    let tier2Cuts = 0;
    for (const seed of [1, 13, 42, 200]) {
      const state = makeState(SIZE, SIZE);
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
      const config: GenerateConfig = { algorithm: 'random', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed, region: null, relief: 0.7 };
      exec.runSilently(() => generateTerrain(config, state, (c) => exec.execute(c)));
      exec.commitStrokeGroup(exec.getUndoStackSize());
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const t = state.cells[y]![x]!.terrain;
        if (!t || t.type !== TerrainType.Mountain || !t.corners || t.patchOnly || t.elevation < 2) continue;
        if (t.corners.some((c) => c !== 'square' && c !== 'empty')) tier2Cuts++;
      }
    }
    expect(tier2Cuts, 'tall mountains round their tips now').toBeGreaterThan(0);
  });

  it('is deterministic — same seed yields the same corner pattern', () => {
    const a = gen(42).state, b = gen(42).state;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      expect(JSON.stringify(a.cells[y]![x]!.terrain?.corners)).toBe(JSON.stringify(b.cells[y]![x]!.terrain?.corners));
    }
  });
});
