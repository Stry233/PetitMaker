/**
 * The curve's ADJUST phase: after it is drawn the anchors stay, and moving one re-lays the curve.
 *
 * The property that matters is that a tweak produces the curve that WOULD have been drawn at those
 * anchors: RESTORE-THEN-RELAY, not a patch over the path standing there. A mountain curve stacks on
 * what is under it, so painting over the previous path raises it twice, and a cell that path covered
 * has to go back to what it held before the curve rather than to bare ground.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import {
  __resetCurveSession, getCurveSession, isCurveSessionOpen, moveCurveAnchor, setCurveHandle,
} from '../../../tools/paint/curve-session';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import {
  CellZone, CommandType, ItemCategory, TerrainType, type AutoEdgeCut, type EditorEvents, type MacroCoord,
} from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { roadLookup } from '../../../state/object-index';
import { categoryOf } from '../../../state/catalog';

const MICRO = { x: 0, y: 0 };

function world(autoEdgeCut: AutoEdgeCut = 'off') {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ctx = makeToolCtx(state, executor, 1, 1, { autoEdgeCut });
  const tool = new DrawingTool();
  tool.mode = 'curve';
  tool.contentType = 'mountain';
  tool.onActivate(ctx);
  return { state, executor, ctx, tool };
}

function click(tool: DrawingTool, ctx: ReturnType<typeof makeToolCtx>, c: MacroCoord) {
  tool.onPointerDown(c, MICRO, ctx);
  tool.onPointerUp(c, MICRO, ctx);
}

/** Draw a curve through these anchors and finish it. */
function draw(tool: DrawingTool, ctx: ReturnType<typeof makeToolCtx>, anchors: MacroCoord[]) {
  for (const a of anchors) click(tool, ctx, a);
  click(tool, ctx, anchors[anchors.length - 1]!); // double-click finishes
}

const isMountain = (state: ReturnType<typeof makeState>, x: number, y: number) =>
  state.cells[y]?.[x]?.terrain?.type === TerrainType.Mountain;
const painted = (state: ReturnType<typeof makeState>) =>
  state.cells.flat().filter((c) => c?.terrain?.type === TerrainType.Mountain).length;

afterEach(() => {
  __resetCurveSession();
});

describe('the session opens', () => {
  it('after the curve is drawn, carrying its anchors', () => {
    const { ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 4 }, { x: 12, y: 10 }, { x: 20, y: 4 }]);
    const s = getCurveSession();
    expect(s).not.toBeNull();
    expect(s!.anchors.map((a) => [a.x, a.y])).toEqual([[4, 4], [12, 10], [20, 4]]);
  });

  it('not while the curve is still being drawn', () => {
    // The handles would sit under the cursor, in the way of the next click.
    const { ctx, tool } = world();
    click(tool, ctx, { x: 4, y: 4 });
    click(tool, ctx, { x: 12, y: 10 });
    expect(isCurveSessionOpen()).toBe(false);
  });

  it('and closes on a click elsewhere, which does nothing but dismiss', () => {
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 4 }, { x: 12, y: 10 }]);
    const after = painted(state);
    click(tool, ctx, { x: 30, y: 30 });
    expect(isCurveSessionOpen()).toBe(false);
    expect(painted(state), 'the dismissing click is not a new anchor').toBe(after);
  });
});

describe('moving an anchor', () => {
  it('re-lays the curve through the new position and clears the old path', () => {
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    expect(isMountain(state, 12, 10)).toBe(true);
    moveCurveAnchor(1, 12, 20, true);
    expect(isMountain(state, 12, 20), 'the new position').toBe(true);
    expect(isMountain(state, 12, 10), 'the old one').toBe(false);
  });

  it('does not stack the mountain twice where the paths overlap', () => {
    // Restore-then-relay, not patch: painting over the standing path would raise those cells again.
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    const endElev = state.cells[10]?.[4]?.terrain?.elevation;
    moveCurveAnchor(1, 12, 14, true);
    expect(state.cells[10]?.[4]?.terrain?.elevation, 'an endpoint both paths cover').toBe(endElev);
  });

  it('restores what a cell held BEFORE the curve, not bare ground', () => {
    const { state, ctx, tool } = world();
    // Lay a mountain shelf first with a separate straight curve, then draw over part of it.
    draw(tool, ctx, [{ x: 2, y: 6 }, { x: 30, y: 6 }]);
    click(tool, ctx, { x: 35, y: 35 });  // dismiss, so this shelf is finished terrain
    const shelf = state.cells[6]?.[15]?.terrain?.elevation;
    expect(shelf).toBeGreaterThan(0);

    draw(tool, ctx, [{ x: 15, y: 2 }, { x: 15, y: 12 }]);   // crosses the shelf at (15,6)
    moveCurveAnchor(0, 25, 2, true);                         // swing it off the crossing
    expect(state.cells[6]?.[15]?.terrain?.elevation, 'the shelf survives').toBe(shelf);
  });

  it('previews without touching the map until the drag ends', () => {
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }]);
    const before = painted(state);
    moveCurveAnchor(1, 12, 20, false);   // mid-drag
    expect(painted(state)).toBe(before);
    expect(getCurveSession()!.anchors[1]).toMatchObject({ x: 12, y: 20 });
  });
});

describe('direction handles', () => {
  it('bend the curve without moving the anchor', () => {
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    const straight = painted(state);
    setCurveHandle(1, 'out', 0, 5, { commit: true, mirror: true });
    expect(isMountain(state, 12, 10), 'the anchor itself is unmoved').toBe(true);
    expect(painted(state)).not.toBe(straight);
  });
});

describe('history', () => {
  it('gives each tweak its own undo step, back to the curve as first drawn', () => {
    const { state, executor, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    const afterDraw = executor.getUndoStackSize();
    moveCurveAnchor(1, 12, 16, true);
    const afterFirst = executor.getUndoStackSize();
    expect(afterFirst).toBeGreaterThan(afterDraw);
    moveCurveAnchor(1, 12, 22, true);
    expect(executor.getUndoStackSize()).toBeGreaterThan(afterFirst);
    expect(isMountain(state, 12, 22)).toBe(true);

    executor.undo();                       // back to the first tweak
    expect(isMountain(state, 12, 16)).toBe(true);
    expect(isMountain(state, 12, 22)).toBe(false);
    executor.undo();                       // back to the curve as drawn
    expect(isMountain(state, 12, 10)).toBe(true);
  });

  it('redoes a tweak that was undone', () => {
    const { state, executor, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    moveCurveAnchor(1, 12, 18, true);
    executor.undo();
    expect(isMountain(state, 12, 18)).toBe(false);
    executor.redo();
    expect(isMountain(state, 12, 18)).toBe(true);
  });

  it('undoing every step leaves the map as it started', () => {
    const { state, executor, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    moveCurveAnchor(1, 12, 16, true);
    setCurveHandle(0, 'out', 3, 3, { commit: true, mirror: true });
    while (executor.getUndoStackSize() > 0) executor.undo();
    expect(painted(state)).toBe(0);
  });
});

describe('escape', () => {
  it('puts the handles away without undoing the curve', () => {
    // The curve is real terrain by the time the handles are up; Escape dismisses them, it is not
    // an undo. Same outcome as clicking off the curve.
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }]);
    const laid = painted(state);
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(isCurveSessionOpen()).toBe(false);
    expect(painted(state)).toBe(laid);
  });

  it('still abandons a curve that is only part-drawn, painting nothing', () => {
    const { state, ctx, tool } = world();
    click(tool, ctx, { x: 4, y: 10 });
    click(tool, ctx, { x: 12, y: 10 });
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(painted(state)).toBe(0);
  });

  it('reports nothing pending when there is neither', () => {
    const { ctx, tool } = world();
    expect(tool.cancelPending(ctx)).toBe(false);
  });
});

describe('switching away', () => {
  it('puts the handles away when the shape mode changes', () => {
    // A tweak repaints through the tool's CURRENT settings, so handles surviving a mode change
    // would re-lay the curve as something it never was.
    const { ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }]);
    expect(isCurveSessionOpen()).toBe(true);
    tool.mode = 'brush';
    expect(isCurveSessionOpen()).toBe(false);
  });

  it('and when the painted surface changes', () => {
    const { ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }]);
    tool.contentType = 'water';
    expect(isCurveSessionOpen()).toBe(false);
  });

  it('but not when the same value is written again', () => {
    // The canvas assigns these on every relevant store change, not only on a real switch.
    const { ctx, tool } = world();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }]);
    tool.mode = 'curve';
    tool.contentType = 'mountain';
    expect(isCurveSessionOpen()).toBe(true);
  });
});

describe('a tweak the rules refuse', () => {
  /** A water curve well inside the map is legal at ground level; one that reaches the EDGE is not,
   *  because an off-map neighbour counts as a drop and V-WTR-02 wants that face capped. */
  function waterWorld() {
    const w = world();
    w.tool.contentType = 'water';
    return w;
  }
  const water = (state: ReturnType<typeof makeState>) =>
    state.cells.flat().filter((c) => c?.terrain?.type === TerrainType.Water).length;

  it('reverts the map AND the anchors, rather than leaving handles on a curve that is gone', () => {
    // `commitStroke` stops reverting as soon as the state is LEGAL, which for a stroke that
    // restores and then re-lays can leave the restore standing and the new curve gone. The handles
    // must never describe a curve the map does not have.
    const { state, ctx, tool } = waterWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 20, y: 20 }]);
    const laid = water(state);
    expect(laid).toBeGreaterThan(0);
    const before = getCurveSession()!.anchors.map((a) => ({ x: a.x, y: a.y }));

    moveCurveAnchor(0, 0, 20, true);             // reaches the map edge: uncapped water

    expect(getCurveSession()!.anchors.map((a) => ({ x: a.x, y: a.y })), 'anchors').toEqual(before);
    expect(water(state), 'the curve that was there').toBe(laid);
    expect(state.cells[20]?.[10]?.terrain?.type).toBe(TerrainType.Water);
  });

  it('leaves the session usable after a refusal', () => {
    const { state, ctx, tool } = waterWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 20, y: 20 }]);
    moveCurveAnchor(0, 0, 20, true);
    expect(isCurveSessionOpen()).toBe(true);
    moveCurveAnchor(0, 12, 24, true);            // a legal one still works
    expect(getCurveSession()!.anchors[0]).toMatchObject({ x: 12, y: 24 });
    expect(state.cells[24]?.[12]?.terrain?.type).toBe(TerrainType.Water);
  });

  it('does not leave a dead entry in history for a refused tweak', () => {
    const { executor, ctx, tool } = waterWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 20, y: 20 }]);
    const depth = executor.getUndoStackSize();
    moveCurveAnchor(0, 0, 20, true);
    expect(executor.getUndoStackSize()).toBe(depth);
  });

  it('reverts a tweak that could lay nothing at all', () => {
    // The other failure: every command refused pre-command, so the stroke removes the standing curve
    // and lays no new one. No post-stroke violation is reported for that, only an empty result.
    const { state, ctx, tool } = world();
    draw(tool, ctx, [{ x: 6, y: 6 }, { x: 10, y: 6 }]);
    // Dragging one anchor off the map is a legal PARTIAL tweak — the in-bounds part is laid, the
    // same as drawing over the edge — so the revert must not fire for it.
    moveCurveAnchor(0, 200, 200, true);
    const partial = painted(state);
    expect(partial).toBeGreaterThan(0);
    const anchors = getCurveSession()!.anchors.map((a) => ({ x: a.x, y: a.y }));

    moveCurveAnchor(1, 240, 200, true);          // now the WHOLE path is off the map
    expect(painted(state), 'the partial curve is still there').toBe(partial);
    expect(getCurveSession()!.anchors.map((a) => ({ x: a.x, y: a.y }))).toEqual(anchors);
  });
});

describe('tile curves', () => {
  function tileWorld() {
    const w = world();
    w.tool.contentType = 'tile';
    return w;
  }
  const roads = (state: ReturnType<typeof makeState>) => [...state.objects.values()]
    .filter((o) => categoryOf(o) === ItemCategory.Road);

  it('adjust the same way terrain does', () => {
    const { state, ctx, tool } = tileWorld();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 20, y: 10 }]);
    expect(roads(state).length).toBeGreaterThan(0);
    const laid = roads(state).length;
    moveCurveAnchor(1, 12, 18, true);
    const at = (x: number, y: number) => roads(state).some((o) => o.position.x === x && o.position.y === y);
    expect(at(12, 18), 'the new position').toBe(true);
    expect(at(12, 10), 'the old one').toBe(false);
    expect(roads(state).length).toBeGreaterThan(laid * 0.5); // still a road of comparable length
  });

  it('put back a road the curve paved over, rather than leaving bare ground', () => {
    // The baseline records coatings as well as terrain: a tweak has to restore what it displaced.
    const { state, ctx, tool } = tileWorld();
    draw(tool, ctx, [{ x: 2, y: 6 }, { x: 30, y: 6 }]);
    click(tool, ctx, { x: 35, y: 35 });                     // finish that road
    const before = roads(state).length;
    draw(tool, ctx, [{ x: 15, y: 2 }, { x: 15, y: 12 }]);   // cross it
    moveCurveAnchor(0, 25, 2, true);                        // swing the crossing away
    const stillThere = roads(state).some((o) => o.position.x === 15 && o.position.y === 6);
    expect(stillThere, 'the road that was paved over').toBe(true);
    expect(roads(state).length).toBeGreaterThanOrEqual(before);
  });

  it('undo a tile tweak step by step, back to an empty map', () => {
    const { state, executor, ctx, tool } = tileWorld();
    draw(tool, ctx, [{ x: 4, y: 10 }, { x: 14, y: 10 }]);
    moveCurveAnchor(1, 14, 18, true);
    while (executor.getUndoStackSize() > 0) executor.undo();
    expect(roads(state)).toHaveLength(0);
  });
});

describe('a path that clips ground it may not build on', () => {
  /** A map with a strip of sea straight down the middle. */
  function zonedWorld() {
    const w = world();
    for (let y = 0; y < 40; y++) {
      for (let x = 18; x <= 22; x++) {
        w.state.template.zones[y]![x] = CellZone.Void;
        w.state.cells[y]![x]!.zone = CellZone.Void;
      }
    }
    return w;
  }

  it('lays the part it can, instead of nothing at all', () => {
    // The plan batches a shape into ONE command per elevation and a command is refused WHOLE if any
    // single cell in it is, so a path that so much as clips the sea has to retry cell by cell or it
    // paints nothing at all.
    const { state, ctx, tool } = zonedWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 30, y: 20 }]);
    expect(painted(state)).toBeGreaterThan(0);
    expect(isMountain(state, 10, 20), 'the near side').toBe(true);
    expect(isMountain(state, 30, 20), 'the far side').toBe(true);
    expect(isMountain(state, 20, 20), 'the sea it crosses').toBe(false);
  });

  it('keeps the handles, because the curve IS on the map', () => {
    const { ctx, tool } = zonedWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 30, y: 20 }]);
    expect(isCurveSessionOpen()).toBe(true);
  });

  it('adjusts across the strip without clearing the curve', () => {
    const { state, ctx, tool } = zonedWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 30, y: 20 }]);
    moveCurveAnchor(1, 30, 28, true);
    expect(painted(state), 'still a curve').toBeGreaterThan(0);
    expect(isMountain(state, 30, 28), 'the moved anchor').toBe(true);
    expect(isMountain(state, 20, 20), 'never the sea').toBe(false);
    expect(getCurveSession()!.anchors[1], 'the anchors followed').toMatchObject({ x: 30, y: 28 });
  });

  it('clears the OLD curve when adjusting, even where it crossed the sea', () => {
    // The baseline covers every cell the curve ASKED for, forbidden ones included, and one of those in
    // a batch refuses the whole restore: the previous curve then stands while the new one is laid over
    // it and the map holds both, which is why the restore splits per cell.
    const { state, ctx, tool } = zonedWorld();
    draw(tool, ctx, [{ x: 10, y: 20 }, { x: 30, y: 20 }]);
    const laid = painted(state);
    moveCurveAnchor(0, 10, 30, true);
    expect(isMountain(state, 10, 20), 'where the old curve started').toBe(false);
    expect(isMountain(state, 10, 30), 'where it starts now').toBe(true);
    // Not both curves at once: the count is of one curve, not two.
    expect(painted(state)).toBeLessThan(laid * 1.6);
  });

  it('does not strip a road it cannot replace', () => {
    // The tile brush removes the coating under it before laying its own. If the placement is then
    // refused, the removal has already deleted a road nothing is going to put back.
    const { state, ctx, tool } = zonedWorld();
    tool.contentType = 'tile';
    draw(tool, ctx, [{ x: 8, y: 20 }, { x: 16, y: 20 }]);
    click(tool, ctx, { x: 8, y: 34 });                 // dismiss
    const roads = () => [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
    const before = roads().length;
    expect(before).toBeGreaterThan(0);

    // A second tile curve that runs over the first AND on into the sea.
    draw(tool, ctx, [{ x: 12, y: 20 }, { x: 26, y: 20 }]);
    const paved = roads().some((o) => o.position.x >= 18 && o.position.x <= 22);
    expect(paved, 'nothing paved in the sea').toBe(false);
    expect(roads().length, 'the road that was there survives').toBeGreaterThanOrEqual(before);
  });
});


describe('with auto edge-trim on', () => {
  /** Every cell holding terrain, path or not. Auto-trim can MATERIALISE a Γ patch beside the
   *  stroke, and a patch is a real cell that reads as standable surface. */
  const terrainCells = (state: ReturnType<typeof makeState>) =>
    state.cells.flat().filter((c) => c?.terrain).length;

  it('leaves nothing behind on the old path, however far the curve is dragged', () => {
    // The trim pass sweeps the stroke AND its 8-neighbour border, so a tweak that only restored the
    // path itself left the border patches standing. Dragged back and forth they piled into a ridge.
    const { state, ctx, tool } = world('round');
    draw(tool, ctx, [{ x: 6, y: 6 }, { x: 14, y: 14 }, { x: 22, y: 6 }]);
    const first = terrainCells(state);
    for (const y of [20, 8, 24, 6, 18]) moveCurveAnchor(1, 14, y, true);
    moveCurveAnchor(1, 14, 14, true);
    expect(terrainCells(state), 'back at the original anchors, back to the original map').toBe(first);
  });

  it('does not let a leftover patch refuse the curve its own ground', () => {
    // A Γ patch left standing reads through the surface as its base, which is what made the
    // 3x3-support rule turn down cells that were perfectly buildable.
    const { state, ctx, tool } = world('round');
    draw(tool, ctx, [{ x: 6, y: 10 }, { x: 14, y: 16 }, { x: 22, y: 10 }]);
    const fresh = painted(state);
    for (const y of [22, 12, 26]) moveCurveAnchor(1, 14, y, true);
    moveCurveAnchor(1, 14, 16, true);
    expect(painted(state), 'the same anchors paint the same blocks, however many tweaks got here')
      .toBe(fresh);
  });

  it('keeps a corner the user cut by hand beside the curve', () => {
    const { state, ctx, tool } = world('round');
    // A block off the path, with a corner rounded manually.
    ctx.executeCommand({
      type: CommandType.PaintTerrain, timestamp: Date.now(),
      cells: [{ x: 30, y: 30 }], terrainType: TerrainType.Mountain, elevation: 1,
    });
    ctx.executeCommand({
      type: CommandType.TrimCorners, timestamp: Date.now(), x: 30, y: 30, layer: 'terrain',
      beforeCorners: ['square', 'square', 'square', 'square'],
      afterCorners: ['fan', 'square', 'square', 'square'],
    });
    draw(tool, ctx, [{ x: 28, y: 30 }, { x: 32, y: 34 }]);
    moveCurveAnchor(1, 34, 36, true);
    expect(state.cells[30]?.[30]?.terrain?.corners?.[0]).toBe('fan');
  });
});
