/**
 * The curve's gesture: click to drop anchors, drag a placed one to move it, click the last anchor
 * again to finish. Decided on release, so a press can still become a drag; Escape and Delete only
 * take things back.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { resolveNavTap, type PressFacts } from '../../../../view/interaction/press/press-plan';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import type { HostedToolContext } from '../../../../tools/pointer/runtime/host';
import { cell, point } from '../../../_support/grid';
import { isBrushTool } from '../../../../state/editing/edit-mode';

const MICRO = { x: 0, y: 0 };

function world() {
  const state = makeState(40, 40);
  const executor = makeExecutor(state);
  const ctx = makeToolCtx(state, executor);
  const tool = new DrawingTool();
  arm(ctx, { shape: 'curve', contentType: 'mountain' });
  tool.onActivate(ctx);
  return { state, executor, ctx, tool };
}

function click(tool: DrawingTool, ctx: ReturnType<typeof makeToolCtx>, c: MacroCoord) {
  tool.onPointerDown(cell(c), point(MICRO), ctx);
  tool.onPointerUp(cell(c), point(MICRO), ctx);
}

const painted = (state: ReturnType<typeof makeState>) =>
  state.cells.flat().filter((cell) => cell?.terrain?.type === TerrainType.Mountain).length;

beforeEach(() => { /* each test builds its own world */ });

describe('placing anchors', () => {
  it('[EDIT-36] paints nothing until the curve is finished, however many anchors are placed', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 8, y: 9 });
    click(tool, ctx, { x: 15, y: 3 });
    click(tool, ctx, { x: 22, y: 10 });
    expect(painted(state)).toBe(0);
  });

  it('[EDIT-36] commits on a double-click, and the painted path reaches every anchor', () => {
    const { state, ctx, tool } = world();
    const anchors = [{ x: 2, y: 2 }, { x: 8, y: 9 }, { x: 15, y: 3 }];
    for (const a of anchors) click(tool, ctx, a);
    click(tool, ctx, anchors[anchors.length - 1]!); // a second click in place finishes
    expect(painted(state)).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(state.cells[a.y]?.[a.x]?.terrain?.type, `anchor ${a.x},${a.y}`).toBe(TerrainType.Mountain);
    }
  });

  it('times the finishing double-click by the release events, not by when the handler runs', () => {
    const { state, ctx, tool } = world();
    const tap = (c: MacroCoord, eventTime: number) => {
      ctx.eventTime = eventTime;
      tool.onPointerDown(cell(c), point(MICRO), ctx);
      tool.onPointerUp(cell(c), point(MICRO), ctx);
    };
    tap({ x: 2, y: 2 }, 0);
    tap({ x: 9, y: 9 }, 600);
    tap({ x: 9, y: 9 }, 1100);                  // half a second after the last release
    expect(painted(state), 'taps further apart than the window on the event clock').toBe(0);
    tap({ x: 9, y: 9 }, 1300);
    expect(painted(state)).toBeGreaterThan(0);
  });

  it('swallows the tail of a double-click, rather than starting a new curve on that cell', () => {
    // A double-click on the last anchor finishes, and its third click must not start a new curve.
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 9, y: 9 });
    click(tool, ctx, { x: 9, y: 9 });     // finishes
    const after = painted(state);
    click(tool, ctx, { x: 9, y: 9 });     // the second half of the double-click
    click(tool, ctx, { x: 20, y: 20 });
    click(tool, ctx, { x: 28, y: 24 });
    click(tool, ctx, { x: 28, y: 24 });
    expect(painted(state)).toBeGreaterThan(after);
    // A curve started by the swallowed click would have run from (9,9) through here.
    expect(state.cells[15]?.[15]?.terrain, 'between the two curves').toBeNull();
  });
});

describe('re-clicking an earlier anchor', () => {
  it('does not stack a second anchor on the same cell', () => {
    // Finishing needs the previous click on the same cell, so this neither finishes nor duplicates.
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 5, y: 5 });
    click(tool, ctx, { x: 12, y: 5 });
    click(tool, ctx, { x: 5, y: 5 });
    expect(painted(state)).toBe(0);
    click(tool, ctx, { x: 5, y: 5 }); // a double-click on that cell
    expect(painted(state)).toBeGreaterThan(0);
  });
});

describe('editing a placed anchor', () => {
  it('moves the anchor instead of adding one, and the committed path follows it', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 10, y: 2 });
    click(tool, ctx, { x: 18, y: 2 });
    tool.onPointerDown(cell({ x: 10, y: 2 }), point(MICRO), ctx);
    tool.onPointerMove(cell({ x: 10, y: 12 }), point(MICRO), ctx);
    tool.onPointerUp(cell({ x: 10, y: 12 }), point(MICRO), ctx);
    click(tool, ctx, { x: 18, y: 2 });
    click(tool, ctx, { x: 18, y: 2 });   // double-click to finish
    expect(state.cells[12]?.[10]?.terrain?.type, 'the moved anchor').toBe(TerrainType.Mountain);
    expect(state.cells[2]?.[10]?.terrain, 'the vacated anchor cell').toBeNull();
  });

  it('releasing a drag is not a click: it neither adds an anchor nor arms a finish', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 10, y: 2 });
    tool.onPointerDown(cell({ x: 10, y: 2 }), point(MICRO), ctx);
    tool.onPointerMove(cell({ x: 10, y: 8 }), point(MICRO), ctx);
    tool.onPointerUp(cell({ x: 10, y: 8 }), point(MICRO), ctx);
    expect(painted(state)).toBe(0);
  });
});

describe('taking it back', () => {
  it('[EDIT-36] Escape abandons the whole curve, painting nothing', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 9, y: 9 });
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(painted(state)).toBe(0);
    // Nothing is left pending.
    expect(tool.cancelPending(ctx)).toBe(false);
  });

  it('[EDIT-36] Delete takes back the last anchor only', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 10, y: 2 });
    click(tool, ctx, { x: 30, y: 30 });   // a stray one
    expect(tool.undoPendingStep(ctx)).toBe(true);
    click(tool, ctx, { x: 18, y: 2 });
    click(tool, ctx, { x: 18, y: 2 });   // double-click to finish
    expect(state.cells[30]?.[30]?.terrain, 'the anchor that was taken back').toBeNull();
    expect(state.cells[2]?.[18]?.terrain?.type).toBe(TerrainType.Mountain);
  });

  it('reports nothing pending when no curve is being drawn, so the key falls through', () => {
    const { ctx, tool } = world();
    expect(tool.cancelPending(ctx)).toBe(false);
    expect(tool.undoPendingStep(ctx)).toBe(false);
  });

  it('reports nothing pending in another mode, where the key means the selection', () => {
    const { ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    arm(ctx, { shape: 'free' });
    expect(tool.cancelPending(ctx)).toBe(false);
  });
});

/**
 * A right press that never moved has no camera meaning, so it ends a standing chain, which has painted
 * nothing yet, as it does `road-link`'s first mark.
 */
describe('a nav tap while the chain stands', () => {
  /** What the pointer machine builds for a nav tap over bare map, the tool's own answer included. */
  function navFacts(tool: DrawingTool, ctx: HostedToolContext): PressFacts {
    return {
      button: 2, // the right button, which navigates
      inputMode: 'pc',
      selectMode: false,
      brush: isBrushTool(tool.id),
      armedItemId: null,
      copyHeld: false,
      selection: [],
      selectingRegion: false,
      panDragHeld: false,
      multiSelectHeld: false,
      moveLatched: false,
      macro: { x: 20, y: 20 },
      terrain: { x: 20, y: 20 },
      pick: null,
      hit: null,
      placementAllowed: true,
      pendingGesture: tool.hasPending?.(ctx) ?? false,
      clickOnlyStroke: false,
      armedStrokes: false,
      toolGrabs: false,
      toolSelects: false,
      toolSelectHit: null,
    };
  }

  it('ends the gesture, and the chain goes without painting anything', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 9, y: 9 });

    expect(resolveNavTap(navFacts(tool, ctx))).toEqual([{ kind: 'cancel-pending' }]);
    // The pointer machine carries out that intent through `cancelPending`.
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(painted(state)).toBe(0);
    expect(resolveNavTap(navFacts(tool, ctx)), 'and there is nothing left to end').toEqual([]);
  });

  it('has nothing to end before the first anchor, or once the curve is real terrain', () => {
    const { state, ctx, tool } = world();
    expect(resolveNavTap(navFacts(tool, ctx))).toEqual([]);

    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 9, y: 9 });
    click(tool, ctx, { x: 9, y: 9 });   // double-click to finish
    expect(painted(state)).toBeGreaterThan(0);
    // The committed curve's adjust handles are not a gesture a nav tap ends, as with a committed
    // route (`MacroTool.hasPending`).
    expect(resolveNavTap(navFacts(tool, ctx))).toEqual([]);
  });

  it('has nothing to end in another mode, where a chain cannot be standing', () => {
    const { ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    arm(ctx, { shape: 'free' });
    expect(resolveNavTap(navFacts(tool, ctx))).toEqual([]);
  });
});
