/**
 * Painting ground over an area that reaches the coast: a block bleeds half a cell up and left, so a
 * grass cell beside beach takes no block (V-ZONE-01). The assistant's tools leave those cells out and
 * paint the rest, as the brush does, instead of handing the rule a stroke it refuses whole.
 */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { CellZone } from '../../../core/game/zones';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState, setZone } from '../../_support/map-state';

/** A 40 by 30 map whose five left columns and three top rows are beach. */
function coast() {
  const state = makeState(40, 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) if (x < 5 || y < 3) setZone(state, x, y, CellZone.Beach);
  const exec = createExecutor(state, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  const run = (name: string, input: Record<string, unknown>) => executeToolCall({ id: 't', name, input }, deps);
  const raised = () => {
    let n = 0;
    for (const row of state.cells) for (const cell of row) if ((cell.terrain?.elevation ?? 0) >= 1) n++;
    return n;
  };
  return { run, raised };
}

describe('painting ground that reaches the coast', () => {
  spec('ASST-37', 'raises the grass a rectangle over the coast covers and leaves the shore', async () => {
    const { run, raised } = coast();
    const r = await run('paint_terrain', { terrain: 'mountain', elevation: 1, shape: 'rect', x1: 0, y1: 0, x2: 30, y2: 20 });
    expect(r.isError, r.content).toBe(false);
    expect(raised()).toBeGreaterThan(400);
  });

  spec('ASST-37', 'draws a raised level over the coast with draw_area and keeps the rest of the drawing', async () => {
    const { run, raised } = coast();
    const r = await run('draw_area', { x: 0, y: 0, reads_as: 'a raised level by the coast', rows: Array.from({ length: 21 }, () => '1'.repeat(31)) });
    expect(r.isError, r.content).toBe(false);
    expect(raised()).toBeGreaterThan(400);
  });
});
