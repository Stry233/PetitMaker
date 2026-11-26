/**
 * Batch placement lands ordered patterns: a lattice unless told otherwise, the edge of a rectangle
 * for a frame, and alternate cells for a weave of two species.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';

const call = (input: Record<string, unknown>) => ({ id: 't1', name: 'scatter_objects', input });

function world() {
  const state = makeState(32, 32);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  const cellsOf = (id: string): string[] => [...state.objects.values()].filter((o) => o.catalogId === id)
    .map((o) => `${o.position.x},${o.position.y}`).sort();
  return { deps, cellsOf };
}

const RECT = { x1: 4, y1: 4, x2: 9, y2: 8 };

describe('scatter_objects patterns', () => {
  it('plants a lattice on every second cell when no pattern is named', async () => {
    const { deps, cellsOf } = world();
    const done = await executeToolCall(call({ catalogIds: ['flower-rose'], count: 50, ...RECT }), deps);
    expect(done.isError).toBe(false);
    const expected: string[] = [];
    for (let y = 4; y <= 8; y += 2) for (let x = 4; x <= 9; x += 2) expected.push(`${x},${y}`);
    expect(cellsOf('flower-rose')).toEqual(expected.sort());
  });

  it('lines the edge of the rectangle and leaves its inside open', async () => {
    const { deps, cellsOf } = world();
    await executeToolCall(call({ catalogIds: ['flower-rose'], count: 50, ...RECT, pattern: 'border' }), deps);
    const placed = cellsOf('flower-rose');
    expect(placed).toHaveLength(2 * 6 + 2 * 3);
    expect(placed.every((key) => { const [x, y] = key.split(',').map(Number); return x === 4 || x === 9 || y === 4 || y === 8; })).toBe(true);
  });

  it('weaves two species on the two halves of a checker', async () => {
    const { deps, cellsOf } = world();
    await executeToolCall(call({ catalogIds: ['flower-rose'], count: 50, ...RECT, pattern: 'checker' }), deps);
    await executeToolCall(call({ catalogIds: ['flower-daisy'], count: 50, ...RECT, pattern: 'checker', offset: 1 }), deps);
    const roses = cellsOf('flower-rose'), daisies = cellsOf('flower-daisy');
    expect(roses.length + daisies.length).toBe(30);
    expect(roses.every((key) => { const [x, y] = key.split(',').map(Number); return (x! + y!) % 2 === 0; })).toBe(true);
    expect(daisies.every((key) => { const [x, y] = key.split(',').map(Number); return (x! + y!) % 2 === 1; })).toBe(true);
  });
});
