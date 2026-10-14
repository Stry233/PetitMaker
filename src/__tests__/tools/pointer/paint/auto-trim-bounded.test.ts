/**
 * The live auto-trim sweep costs the dab, not the stroke.
 *
 * A road's cut is derived from which sides it connects on, so trimming while the drag is still
 * going has an obligation: the tiles the dab could have reshaped go back to square and are derived
 * again. Only cells adjacent to what the dab just laid can change, so that window is the dab plus
 * its ring — and a sweep over the whole accumulated stroke instead would be quadratic in the
 * stroke's length, which is the shape a long road stroke would feel as the brush getting heavier
 * the longer it is held.
 *
 * Commands issued per dab is the observable that separates the two: the windowed pass squares and
 * re-derives a fixed handful of tiles whatever the stroke has laid so far, while a whole-stroke
 * pass squares and re-derives every trimmed tile in it. The trim result is not this test's subject
 * (live-trim.test.ts and the edge-cut policy tests own that) — only the work it takes.
 */
import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import type { Command, MacroCoord } from '../../../../core/model/types';
import type { ContentType } from '../../../../tools/pointer/paint/drawing-tool';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const MICRO = { x: 0, y: 0 };

/** A serpentine path of `n` distinct cells, three rows apart so each row is its own road run. */
function serpentine(n: number, width: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = 2; out.length < n; y += 3) {
    const run = [...Array(width).keys()].map((i) => ({ x: 2 + i, y }));
    for (const c of (y % 2 === 0 ? run : run.reverse())) { if (out.length < n) out.push(c); }
  }
  return out;
}

/** Commands the tool issued for each dab of a freehand stroke of `n` dabs. */
function commandsPerDab(n: number, content: ContentType): number[] {
  const state = makeState(120, 120);
  const executor = makeExecutor(state);
  let count = 0;
  const ctx = makeToolCtx(state, executor, 1, 1, {
    contentType: content,
    autoEdgeCut: 'round',
    execute: (cmd: Command) => { count++; return executor.execute(cmd); },
  });
  const tool = new DrawingTool();
  arm(ctx, { shape: 'free', contentType: content });
  tool.onActivate(ctx);

  const path = serpentine(n, 40);
  const per: number[] = [];
  tool.onPointerDown(cell(path[0]!), point(MICRO), ctx);
  for (const p of path.slice(1)) {
    const before = count;
    tool.onPointerMove(cell(p), point(MICRO), ctx);
    per.push(count - before);
  }
  return per;
}

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

describe('the live auto-trim sweep is bounded by the dab', () => {
  for (const content of ['road', 'mountain'] as const) {
    it(`a ${content} brush issues the same work per dab at 500 dabs as at 250`, () => {
      const per = commandsPerDab(500, content);
      const early = mean(per.slice(50, 150));   // past the first-dab warm-up
      const late = mean(per.slice(400, 500));

      expect(early).toBeGreaterThan(0);
      // A whole-stroke sweep would put hundreds of commands in a late dab against a handful in an
      // early one. The bound is generous on purpose: what it must catch is growth, not a constant.
      expect(late).toBeLessThanOrEqual(early * 1.5 + 1);
    });
  }

  it('doubling the stroke does not raise what a dab costs', () => {
    const short = mean(commandsPerDab(250, 'road').slice(150, 250));
    const long = mean(commandsPerDab(500, 'road').slice(400, 500));
    expect(long).toBeLessThanOrEqual(short * 1.5 + 1);
  });
});
