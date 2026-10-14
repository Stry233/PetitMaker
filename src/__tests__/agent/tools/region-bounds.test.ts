/**
 * The composer's region chip and the agent's out-of-region refusal quote one derivation,
 * `core/grid/rect.ts:regionBounds`: the refusal the tool surface emits is checked against that
 * reading, so a second copy of the math anywhere would fail this file rather than ship two answers.
 */
import { describe, it, expect } from 'vitest';
import { regionBounds } from '../../../core/grid/rect';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState, makeExecutor } from '../../_support/map-state';
import type { MacroCoord } from '../../../core/model/types';

/** The three shapes a painted region comes in: a filled rect, a scatter of loose cells, and the
 *  single cell a stray tap leaves. */
const REGIONS: { name: string; cells: MacroCoord[] }[] = [
  { name: 'a filled 3x2 rect', cells: [{ x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }, { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }] },
  { name: 'a scatter whose extremes are on different cells', cells: [{ x: 5, y: 9 }, { x: 2, y: 3 }, { x: 8, y: 1 }, { x: 12, y: 4 }] },
  { name: 'one cell', cells: [{ x: 31, y: 17 }] },
];

describe('the agent guard and the panel chip share ONE derivation', () => {
  /** Driven through the real tool surface: whatever the guard says to
   *  the model is spelled out of this reading, so a chip built on it is quoting the same sentence. */
  it('produces the numbers the out-of-region refusal quotes back to the model', async () => {
    for (const f of REGIONS) {
      const state = makeState(64, 64);
      const exec = makeExecutor(state);
      const deps: AgentToolDeps = {
        getState: () => state, getExecutor: () => exec, getRegion: () => f.cells,
      };
      // Far outside every fixture's box, so the guard is what refuses rather than a map rule.
      const r = await executeToolCall(
        { id: 't1', name: 'paint_terrain', input: { rect: { x1: 50, y1: 50, x2: 52, y2: 52 }, terrain: 'mountain', elevation: 1 } },
        deps,
      );
      const b = regionBounds(f.cells)!;
      expect(r.detail?.regionBlocked, f.name).toBe(true);
      expect(r.content, f.name)
        .toContain(`(${b.count} cells within (${b.x1},${b.y1})-(${b.x2},${b.y2}))`);
    }
  });
});
