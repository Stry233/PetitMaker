/**
 * Auto-trim while a freehand stroke is being drawn.
 *
 * The brush paints as it moves, so without this the stroke reads square under the cursor and only
 * rounds on release. The property that has to hold is that trimming as it goes changes nothing
 * about where the stroke ENDS UP: a corner rounded early and built against later must be derived
 * again from the mass the stroke finished with.
 */
import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { applyAutoEdgeCut } from '../../tools/edge-cut/auto-edge-cut';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type AutoEdgeCut, type EditorEvents, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import type { ContentType } from '../../tools/paint/drawing-tool';
import { makeState } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { roadLookup } from '../../state/object-index';

const MICRO = { x: 0, y: 0 };

function world(brush = 3, content: ContentType = 'mountain', autoEdgeCut: AutoEdgeCut = 'off') {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ctx = makeToolCtx(state, executor, brush, 1, { autoEdgeCut });
  const tool = new DrawingTool();
  tool.mode = 'brush';
  tool.contentType = content;
  tool.onActivate(ctx);
  return { state, executor, ctx, tool };
}

/** Drag the brush through these points, as the pointer machine would. */
function drag(w: ReturnType<typeof world>, path: MacroCoord[]) {
  w.tool.onPointerDown(path[0]!, MICRO, w.ctx);
  for (const p of path.slice(1)) w.tool.onPointerMove(p, MICRO, w.ctx);
  w.tool.onPointerUp(path[path.length - 1]!, MICRO, w.ctx);
}

/** Every cell's shape, as a comparable string. */
const shapeOf = (state: GridState) => {
  const out: string[] = [];
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    const t = cell?.terrain;
    if (!t) return;
    out.push(`${x},${y}:${t.type}:${t.elevation}:${(t.corners ?? []).join('|')}${t.patchOnly ? ':patch' : ''}`);
  }));
  return out.sort();
};

/** The same mass, painted in one go and trimmed once — what the stroke is supposed to end as. */
function paintedAtOnce(cells: MacroCoord[], mode: AutoEdgeCut) {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  executor.execute({
    type: CommandType.PaintTerrain, timestamp: Date.now(),
    cells, terrainType: TerrainType.Mountain, elevation: 1,
  });
  applyAutoEdgeCut({ gridState: state, executeCommand: (cmd) => executor.execute(cmd) }, mode, cells, []);
  return state;
}

const PATHS: { name: string; path: MacroCoord[] }[] = [
  { name: 'a straight drag', path: [{ x: 6, y: 10 }, { x: 9, y: 10 }, { x: 13, y: 10 }, { x: 18, y: 10 }] },
  { name: 'an L', path: [{ x: 8, y: 8 }, { x: 14, y: 8 }, { x: 14, y: 14 }] },
  // The case the squaring exists for: the stroke comes back alongside itself, so corners it rounded
  // on the way out are interior by the time it finishes.
  { name: 'a drag that doubles back', path: [{ x: 8, y: 20 }, { x: 16, y: 20 }, { x: 16, y: 23 }, { x: 8, y: 23 }] },
  { name: 'a loop', path: [{ x: 10, y: 28 }, { x: 16, y: 28 }, { x: 16, y: 33 }, { x: 10, y: 33 }, { x: 10, y: 28 }] },
];

for (const mode of ['round', 'rect'] as const) {
  describe(`a freehand stroke trimmed as it is drawn (${mode})`, () => {
    for (const { name, path } of PATHS) {
      it(`ends in the same shape as ${name} trimmed once at the end`, () => {
        const w = world(3, 'mountain', mode);
        drag(w, path);
        const cells: MacroCoord[] = [];
        w.state.cells.forEach((row, y) => row.forEach((cell, x) => {
          if (cell?.terrain && !cell.terrain.patchOnly) cells.push({ x, y });
        }));
        expect(shapeOf(w.state)).toEqual(shapeOf(paintedAtOnce(cells, mode)));
      });
    }

    it('matches the finished shape at every point of the drag, not just at the end', () => {
      // The dab-local pass keeps corners it finds, so without re-deriving its window a corner
      // rounded on one dab stays rounded when the next dab builds against it — rounded notches
      // through the middle of the band, and a stroke that changes shape when the button comes up.
      const w = world(3, 'mountain', mode);
      const path = [{ x: 8, y: 8 }, { x: 12, y: 8 }, { x: 12, y: 12 }, { x: 8, y: 12 }, { x: 8, y: 9 }];
      w.tool.onPointerDown(path[0]!, MICRO, w.ctx);
      for (const p of path.slice(1)) {
        w.tool.onPointerMove(p, MICRO, w.ctx);
        const painted: MacroCoord[] = [];
        w.state.cells.forEach((row, y) => row.forEach((c, x) => {
          if (c?.terrain && !c.terrain.patchOnly) painted.push({ x, y });
        }));
        expect(shapeOf(w.state), `mid-drag at ${p.x},${p.y}`).toEqual(shapeOf(paintedAtOnce(painted, mode)));
      }
      w.tool.onPointerUp(path[path.length - 1]!, MICRO, w.ctx);
    });

    it('has already rounded the shape before the button comes up', () => {
      // The whole point: mid-drag, the mass on the map is trimmed rather than square.
      const w = world(3, 'mountain', mode);
      w.tool.onPointerDown({ x: 10, y: 10 }, MICRO, w.ctx);
      w.tool.onPointerMove({ x: 15, y: 10 }, MICRO, w.ctx);
      const cut = w.state.cells.flat().filter((c) => c?.terrain?.corners?.some((k) => k !== 'square')).length;
      expect(cut).toBeGreaterThan(0);
      w.tool.onPointerUp({ x: 15, y: 10 }, MICRO, w.ctx);
    });
  });
}

/*
 * A ROAD is a coating rather than a terrain cell, so its shape lives on the placed object and its
 * cut follows its NEIGHBOURS: laying the next tile turns the last one from an end-cap into a
 * through-piece. Trimming as the drag goes therefore has the same obligation terrain has — square
 * the stroke's own cells and derive the shape again — and the same property to hold: what the drag
 * leaves behind is what the same road trimmed once at the end would be.
 */
const roadShapeOf = (state: GridState) =>
  [...state.objects.values()]
    .map((o) => `${o.position.x},${o.position.y}:${(o.corners ?? []).join('|')}`)
    .sort();

/** The same road, laid in one go and trimmed once. Matches `makeToolCtx`'s default `tileMaterial`,
 *  the material the drag's own ctx paves with unless a test overrides it. */
function pavedAtOnce(cells: MacroCoord[], mode: AutoEdgeCut) {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  for (const { x, y } of cells) {
    const road: PlacedObject = {
      id: `r-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, elevation: 0,
    };
    executor.execute({ type: CommandType.PlaceObject, timestamp: Date.now(), object: road, loadValue: 0 });
  }
  applyAutoEdgeCut({ gridState: state, executeCommand: (cmd) => executor.execute(cmd) }, mode, [], cells);
  return state;
}

/** Every road cell the map holds, in the order the comparison wants them. */
const pavedCells = (state: GridState): MacroCoord[] =>
  [...state.objects.values()].map((o) => ({ x: o.position.x, y: o.position.y }));

for (const mode of ['round', 'rect'] as const) {
  describe(`a freehand ROAD stroke trimmed as it is drawn (${mode})`, () => {
    for (const { name, path } of PATHS) {
      it(`ends in the same shape as ${name} paved and trimmed once at the end`, () => {
        const w = world(1, 'tile', mode);
        drag(w, path);
        expect(roadShapeOf(w.state)).toEqual(roadShapeOf(pavedAtOnce(pavedCells(w.state), mode)));
      });
    }

    it('has already trimmed the end cap before the button comes up', () => {
      const w = world(1, 'tile', mode);
      w.tool.onPointerDown({ x: 10, y: 10 }, MICRO, w.ctx);
      w.tool.onPointerMove({ x: 15, y: 10 }, MICRO, w.ctx);
      const cut = [...w.state.objects.values()].filter((o) => o.corners?.some((k) => k !== 'square')).length;
      expect(cut).toBeGreaterThan(0);
      w.tool.onPointerUp({ x: 15, y: 10 }, MICRO, w.ctx);
    });

    it('squares a tile the drag has since paved past', () => {
      // The case the squaring exists for: an end-cap trimmed on one sample is a through-piece by
      // the next, and `cutRoads` keeps the cuts it finds, so without re-deriving the window the
      // drag leaves cut corners running down the middle of the road.
      const w = world(1, 'tile', mode);
      w.tool.onPointerDown({ x: 10, y: 10 }, MICRO, w.ctx);
      w.tool.onPointerMove({ x: 13, y: 10 }, MICRO, w.ctx);
      w.tool.onPointerMove({ x: 16, y: 10 }, MICRO, w.ctx);
      const middle = [...w.state.objects.values()].find((o) => o.position.x === 13 && o.position.y === 10);
      expect(middle?.corners ?? undefined).toBeUndefined();
      w.tool.onPointerUp({ x: 16, y: 10 }, MICRO, w.ctx);
    });
  });
}

describe('with the trim off', () => {
  it('leaves every corner square, during the drag and after it', () => {
    const w = world();
    drag(w, [{ x: 8, y: 8 }, { x: 14, y: 8 }, { x: 14, y: 14 }]);
    const cut = w.state.cells.flat().filter((c) => c?.terrain?.corners?.some((k) => k !== 'square')).length;
    expect(cut).toBe(0);
  });
});
