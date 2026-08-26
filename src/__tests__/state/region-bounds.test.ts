/**
 * region-bounds.test.ts — the ONE region derivation, and the proof that it is one.
 *
 * The numbers the composer's chip says and the numbers the agent's refusal quotes back to the model
 * are the same numbers, so a chip reading "1,128 cells within (2,3)-(48,44)" over a run the model
 * was just told to keep inside (2,3)-(48,44) cannot drift. That is a claim about IDENTITY rather
 * than about agreement: the guard is checked here against the function itself, and the refusal
 * STRING the tool surface emits is checked against the same reading, so a second copy of the math
 * anywhere would fail this file rather than ship two answers.
 */
import { describe, it, expect } from 'vitest';
import { regionBounds } from '../../state/region-bounds';
import { regionBounds as toolsRegionBounds } from '../../agent/tools/tools-common';
import { executeToolCall, type AgentToolDeps } from '../../agent/tools';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { roadLookup } from '../../state/object-index';
import { makeState } from '../rules/_helpers';
import type { EditorEvents, MacroCoord } from '../../core/model/types';

/** The three shapes a painted region comes in: a filled rect, a scatter of loose cells, and the
 *  single cell a stray tap leaves. */
const FIXTURES: { name: string; cells: MacroCoord[]; expect: ReturnType<typeof regionBounds> }[] = [
  {
    name: 'a filled 3x2 rect',
    cells: [
      { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 },
      { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 },
    ],
    expect: { count: 6, x1: 4, y1: 7, x2: 6, y2: 8 },
  },
  {
    name: 'a scatter whose extremes are on different cells',
    cells: [{ x: 5, y: 9 }, { x: 2, y: 3 }, { x: 8, y: 1 }, { x: 12, y: 4 }],
    expect: { count: 4, x1: 2, y1: 1, x2: 12, y2: 9 },
  },
  {
    name: 'one cell',
    cells: [{ x: 31, y: 17 }],
    expect: { count: 1, x1: 31, y1: 17, x2: 31, y2: 17 },
  },
];

describe('regionBounds', () => {
  it('answers null for an empty region: [] is the whole map, not a box of no cells', () => {
    expect(regionBounds([])).toBeNull();
  });

  for (const f of FIXTURES) {
    it(`reads ${f.name}`, () => {
      expect(regionBounds(f.cells)).toEqual(f.expect);
    });
  }
});

describe('the agent guard and the panel chip share ONE derivation', () => {
  /** Not "they agree" — they are the SAME function. A re-implementation that happened to agree on
   *  these three fixtures would pass an equality test and diverge on the fourth. */
  it('is the identical function the tool surface exports', () => {
    expect(toolsRegionBounds).toBe(regionBounds);
  });

  /** The other half of the claim, driven through the REAL tool surface: whatever the guard says to
   *  the model is spelled out of this reading, so a chip built on it is quoting the same sentence. */
  it('produces the numbers the out-of-region refusal quotes back to the model', async () => {
    for (const f of FIXTURES) {
      const state = makeState(64, 64);
      const exec = new CommandExecutor(
        state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state),
      );
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
