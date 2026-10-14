/** A stroke's generation mark is history: undo, redo, rollback and an outer collapse carry it. */
import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type Command, type GenerationMark } from '../../../core/model/types';
import { makeState } from '../../_support/map-state';
import { bareExecutor } from '../../_support/kernel';

const mountain = (x: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1,
});
const mark = (seed: number, scope?: { x: number; y: number }[]): GenerationMark =>
  ({ record: { algorithm: 'test', seed }, ...(scope ? { scope } : {}) });

function world() {
  const state = makeState(10, 10);
  return { state, ex: bareExecutor(state) };
}

/** One stroke that paints at `x` and records `m`. */
function stroke(ex: ReturnType<typeof bareExecutor>, x: number, m: GenerationMark): void {
  const tx = ex.beginStroke();
  ex.execute(mountain(x));
  tx.commit();
  tx.setGeneration(m);
}

describe('Stroke.setGeneration', () => {
  it('undo restores the mark before the stroke and redo the one it wrote', () => {
    const { state, ex } = world();
    stroke(ex, 1, mark(1, [{ x: 1, y: 2 }]));
    stroke(ex, 2, mark(2));
    expect(state.generation?.seed).toBe(2);
    expect(state.generationScope).toBeUndefined();

    ex.undo();
    expect(state.generation?.seed).toBe(1);
    expect(state.generationScope).toEqual([{ x: 1, y: 2 }]);
    ex.undo();
    expect(state.generation).toBeUndefined();
    expect(state.generationScope).toBeUndefined();
    ex.redo();
    ex.redo();
    expect(state.generation?.seed).toBe(2);
  });

  it('an outer collapse keeps the first mark before and the last after', () => {
    const { state, ex } = world();
    stroke(ex, 1, mark(1));
    const outer = ex.beginStroke();
    stroke(ex, 2, mark(2));
    stroke(ex, 3, mark(3));
    outer.collapse();
    expect(ex.historyDepth()).toBe(2);
    ex.undo();
    expect(state.generation?.seed).toBe(1);
    ex.redo();
    expect(state.generation?.seed).toBe(3);
  });

  it('an outer rollback takes the mark back with the terrain', () => {
    const { state, ex } = world();
    stroke(ex, 1, mark(1));
    const outer = ex.beginStroke();
    stroke(ex, 2, mark(2));
    outer.rollback();
    expect(state.generation?.seed).toBe(1);
  });

  it('a stroke that left no entry writes the mark without history', () => {
    const { state, ex } = world();
    const tx = ex.beginStroke();
    tx.commit();
    tx.setGeneration(mark(4));
    expect(state.generation?.seed).toBe(4);
    expect(ex.canUndo()).toBe(false);
  });
});
