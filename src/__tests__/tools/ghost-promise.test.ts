/**
 * The ghost's promise, against what the click actually leaves.
 *
 * Not a comparison of two derivations — the same anchors are previewed and then committed, and the
 * map is read back. Anything the commit does that the preview does not shows up here, which is the
 * only way to be sure there is one procedure and not two.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { moveCurveAnchor, __resetCurveSession } from '../../tools/paint/curve-session';
import { applyAutoEdgeCut } from '../../tools/edge-cut/auto-edge-cut';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import {
  CommandType, TerrainType,
  type Corners, type EditorEvents, type GridState, type MacroCoord,
} from '../../core/model/types';
import type { TrimmedCell } from '../../tools/edge-cut/trim-preview';
import { makeState } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { useEditorStore } from '../../state/store';
import { getCell } from '../../core/model/grid-model';
import { trimmedOutline } from '../../canvas/map2d/layers/ghost-geometry';

const MICRO = { x: 0, y: 0 };
const SQUARE: Corners = ['square', 'square', 'square', 'square'];
/** How many straight steps `trimmedOutline` draws a quarter circle with. */
const ARC_STEPS = 6;

/** A world with a layer-1 plain already laid and trimmed, as the user's test had it. */
function world(elevation: number, brush = 3) {
  const state = makeState(50, 50);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const ghost: { cells: MacroCoord[]; trim: readonly TrimmedCell[] }[] = [];
  const ctx = {
    ...makeToolCtx(state, executor, brush, elevation),
    overlay: {
      showGhost(cells: MacroCoord[], _c: number, _t?: boolean, trim?: readonly TrimmedCell[]) {
        ghost.push({ cells, trim: trim ?? [] });
      },
      showGhostSpans() {}, clearGhost() {}, flashCommit() {},
    } as never,
  };
  const plain: MacroCoord[] = [];
  for (let y = 8; y <= 30; y++) for (let x = 8; x <= 30; x++) plain.push({ x, y });
  const start = executor.getUndoStackSize();
  executor.execute({ type: CommandType.PaintTerrain, timestamp: 1, cells: plain, terrainType: TerrainType.Mountain, elevation: 1 });
  applyAutoEdgeCut({ gridState: state, executeCommand: (c) => executor.execute(c) }, 'round', plain, []);
  executor.commitStroke(start);

  const tool = new DrawingTool();
  tool.mode = 'curve';
  tool.contentType = 'mountain';
  tool.onActivate(ctx);
  return { state, executor, ctx, tool, ghost };
}

/** A cell's shape on the map, in the ghost's own vocabulary. */
const shapeOn = (state: GridState, x: number, y: number) => {
  const t = getCell(state.cells, x, y)?.terrain;
  return t ? `${(t.corners ?? SQUARE).join('|')}${t.patchOnly ? ':patch' : ''}` : 'none';
};
const shapeOf = (t: TrimmedCell) => `${t.corners.join('|')}${t.patch ? ':patch' : ''}`;

afterEach(() => {
  __resetCurveSession();
  useEditorStore.setState({ autoEdgeCut: 'off' });
});

describe('a curve laid at a higher layer on an existing plain', () => {
  it('promises, while it is being DRAWN, the shape the finish produces', () => {
    useEditorStore.setState({ autoEdgeCut: 'round' });
    const w = world(2);
    const click = (c: MacroCoord) => { w.tool.onPointerDown(c, MICRO, w.ctx); w.tool.onPointerUp(c, MICRO, w.ctx); };
    const anchors = [{ x: 12, y: 14 }, { x: 19, y: 22 }, { x: 26, y: 14 }];
    click(anchors[0]!); click(anchors[1]!);
    // Hovering the last anchor: the ghost now shows the curve the next click will lay.
    w.ghost.length = 0;
    w.tool.onPointerMove(anchors[2]!, MICRO, w.ctx);
    const promised = w.ghost[w.ghost.length - 1]!;
    click(anchors[2]!);
    click(anchors[2]!);          // double-click finishes

    const said = new Map(promised.trim.map((t) => [`${t.x},${t.y}`, shapeOf(t)]));
    expect(promised.trim.length, 'a curve a layer up rounds along its whole length')
      .toBeGreaterThan(promised.cells.length / 4);
    const wrong: string[] = [];
    for (const c of promised.cells) {
      const actual = shapeOn(w.state, c.x, c.y);
      const promise = said.get(`${c.x},${c.y}`) ?? SQUARE.join('|');
      if (actual !== 'none' && actual !== promise) wrong.push(`${c.x},${c.y}: promised ${promise}, got ${actual}`);
    }
    // And what the OUTLINE makes of that data: every rounded corner it was told about has to reach
    // the drawing. The ghost once promised square steps for exactly this curve while the map came
    // out scalloped, because the outline was dropping cuts it judged to be inside the shape.
    const edges = trimmedOutline(promised.cells, promised.trim);
    const arcSteps = edges.filter((e) => Math.abs(e.ax - e.bx) > 1e-9 && Math.abs(e.ay - e.by) > 1e-9).length;
    const rounded = promised.trim.reduce((n, t) => n + t.corners.filter((k) => k === 'fan').length, 0);
    expect(arcSteps / ARC_STEPS, 'one arc drawn per rounded corner').toBe(rounded);
    expect(wrong.slice(0, 6)).toEqual([]);
  });

  it('leaves the map in the shape the ghost promised', () => {
    useEditorStore.setState({ autoEdgeCut: 'round' });
    const w = world(2);
    const click = (c: MacroCoord) => { w.tool.onPointerDown(c, MICRO, w.ctx); w.tool.onPointerUp(c, MICRO, w.ctx); };
    for (const a of [{ x: 12, y: 14 }, { x: 19, y: 22 }, { x: 26, y: 14 }]) click(a);
    click({ x: 26, y: 14 });

    // Tweak an anchor: the ghost is issued on the drag, the map on the release, from the SAME
    // anchors — so the two are directly comparable.
    w.ghost.length = 0;
    moveCurveAnchor(1, 19, 26, false);
    const promised = w.ghost[w.ghost.length - 1]!;
    expect(promised.trim.length, 'the trim has something to say about this curve').toBeGreaterThan(0);
    moveCurveAnchor(1, 19, 26, true);

    const wrong: string[] = [];
    for (const t of promised.trim) {
      const actual = shapeOn(w.state, t.x, t.y);
      if (actual !== shapeOf(t)) wrong.push(`${t.x},${t.y}: promised ${shapeOf(t)}, got ${actual}`);
    }
    expect(wrong).toEqual([]);
  });

  it('and promises a shape for every cell that ends up with one', () => {
    // The other direction: a cut the click makes inside the ghost's own footprint that the ghost
    // never mentioned would read as a square in the preview and a rounded block on the map.
    useEditorStore.setState({ autoEdgeCut: 'round' });
    const w = world(2);
    const click = (c: MacroCoord) => { w.tool.onPointerDown(c, MICRO, w.ctx); w.tool.onPointerUp(c, MICRO, w.ctx); };
    for (const a of [{ x: 12, y: 16 }, { x: 20, y: 20 }, { x: 27, y: 16 }]) click(a);
    click({ x: 27, y: 16 });
    w.ghost.length = 0;
    moveCurveAnchor(1, 20, 24, false);
    const promised = w.ghost[w.ghost.length - 1]!;
    moveCurveAnchor(1, 20, 24, true);

    const said = new Map(promised.trim.map((t) => [`${t.x},${t.y}`, shapeOf(t)]));
    const missed: string[] = [];
    for (const c of promised.cells) {
      const actual = shapeOn(w.state, c.x, c.y);
      if (actual === 'none' || actual === SQUARE.join('|')) continue;   // nothing to promise
      if (!said.has(`${c.x},${c.y}`)) missed.push(`${c.x},${c.y}: map has ${actual}, ghost said square`);
    }
    expect(missed).toEqual([]);
  });
});
