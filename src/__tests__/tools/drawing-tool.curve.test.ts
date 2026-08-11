/**
 * The curve's gesture: click to drop anchors, drag a placed one to move it, click the LAST anchor
 * to finish and the FIRST to close. Decided on release, so the same press can be the start of a
 * drag. No keyboard needed to commit — Escape and Delete only take things back.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type EditorEvents, type MacroCoord } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { roadLookup } from '../../state/object-index';

const MICRO = { x: 0, y: 0 };

function world() {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ctx = makeToolCtx(state, executor);
  const tool = new DrawingTool();
  tool.mode = 'curve';
  tool.contentType = 'mountain';
  tool.onActivate(ctx);
  return { state, executor, ctx, tool };
}

/** A click: press and release at one cell. */
function click(tool: DrawingTool, ctx: ReturnType<typeof makeToolCtx>, c: MacroCoord) {
  tool.onPointerDown(c, MICRO, ctx);
  tool.onPointerUp(c, MICRO, ctx);
}

const painted = (state: ReturnType<typeof makeState>) =>
  state.cells.flat().filter((cell) => cell?.terrain?.type === TerrainType.Mountain).length;

beforeEach(() => { /* each test builds its own world */ });

describe('placing anchors', () => {
  it('paints nothing until the curve is finished, however many anchors are placed', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 8, y: 9 });
    click(tool, ctx, { x: 15, y: 3 });
    click(tool, ctx, { x: 22, y: 10 });
    expect(painted(state)).toBe(0);
  });

  it('commits on a double-click, and the painted path reaches every anchor', () => {
    const { state, ctx, tool } = world();
    const anchors = [{ x: 2, y: 2 }, { x: 8, y: 9 }, { x: 15, y: 3 }];
    for (const a of anchors) click(tool, ctx, a);
    click(tool, ctx, anchors[anchors.length - 1]!); // second click in place = finish
    expect(painted(state)).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(state.cells[a.y]?.[a.x]?.terrain?.type, `anchor ${a.x},${a.y}`).toBe(TerrainType.Mountain);
    }
  });

  it('swallows the tail of a double-click, rather than starting a new curve on that cell', () => {
    // Finishing IS a click on the last anchor, so anyone who double-clicks it would otherwise drop
    // a fresh anchor where they were only confirming.
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 9, y: 9 });
    click(tool, ctx, { x: 9, y: 9 });     // finishes
    const after = painted(state);
    click(tool, ctx, { x: 9, y: 9 });     // the second half of the double-click
    // A second, deliberate curve well away from the first.
    click(tool, ctx, { x: 20, y: 20 });
    click(tool, ctx, { x: 28, y: 24 });
    click(tool, ctx, { x: 28, y: 24 });
    expect(painted(state)).toBeGreaterThan(after);
    // Had the swallowed click started a curve at (9,9), the second one would have run from there
    // to (20,20) and painted the ground between.
    expect(state.cells[15]?.[15]?.terrain, 'between the two curves').toBeNull();
  });
});

describe('re-clicking an earlier anchor', () => {
  it('does not stack a second anchor on the same cell', () => {
    // Clicking back over the first anchor is an ordinary click on an existing one; it neither
    // duplicates it nor finishes (the double-click test needs the PREVIOUS click on that cell).
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 5, y: 5 });
    click(tool, ctx, { x: 12, y: 5 });
    click(tool, ctx, { x: 5, y: 5 });
    expect(painted(state)).toBe(0);
    click(tool, ctx, { x: 5, y: 5 }); // now it IS a double-click
    expect(painted(state)).toBeGreaterThan(0);
  });
});

describe('editing a placed anchor', () => {
  it('moves the anchor instead of adding one, and the committed path follows it', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 10, y: 2 });
    click(tool, ctx, { x: 18, y: 2 });
    // Pick the middle anchor up and drag it down.
    tool.onPointerDown({ x: 10, y: 2 }, MICRO, ctx);
    tool.onPointerMove({ x: 10, y: 12 }, MICRO, ctx);
    tool.onPointerUp({ x: 10, y: 12 }, MICRO, ctx);
    click(tool, ctx, { x: 18, y: 2 });
    click(tool, ctx, { x: 18, y: 2 });   // double-click to finish
    expect(state.cells[12]?.[10]?.terrain?.type, 'the moved anchor').toBe(TerrainType.Mountain);
    expect(state.cells[2]?.[10]?.terrain, 'where it used to be').toBeNull();
  });

  it('releasing a drag is not a click: it neither adds an anchor nor arms a finish', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 10, y: 2 });
    tool.onPointerDown({ x: 10, y: 2 }, MICRO, ctx);
    tool.onPointerMove({ x: 10, y: 8 }, MICRO, ctx);
    tool.onPointerUp({ x: 10, y: 8 }, MICRO, ctx);
    // The drag MOVED, so its release is not a click and cannot have finished anything.
    expect(painted(state)).toBe(0);
  });
});

describe('taking it back', () => {
  it('Escape abandons the whole curve, painting nothing', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 2, y: 2 });
    click(tool, ctx, { x: 9, y: 9 });
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(painted(state)).toBe(0);
    // And the gesture is really gone: the next click starts over rather than continuing.
    expect(tool.cancelPending(ctx)).toBe(false);
  });

  it('Delete takes back the last anchor only', () => {
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
    tool.mode = 'brush';
    expect(tool.cancelPending(ctx)).toBe(false);
  });
});
