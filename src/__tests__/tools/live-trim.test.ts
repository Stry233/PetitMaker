/**
 * Auto-trim while a freehand stroke is being drawn.
 *
 * The brush paints as it moves, so without this the stroke reads square under the cursor and only
 * rounds on release. The property that has to hold is that trimming as it goes changes nothing
 * about where the stroke ENDS UP: a corner rounded early and built against later must be derived
 * again from the mass the stroke finished with.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { applyAutoEdgeCut } from '../../tools/edge-cut/auto-edge-cut';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type AutoEdgeCut, type EditorEvents, type GridState, type MacroCoord } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { useEditorStore } from '../../state/store';

const MICRO = { x: 0, y: 0 };

function world(brush = 3) {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const ctx = makeToolCtx(state, executor, brush);
  const tool = new DrawingTool();
  tool.mode = 'brush';
  tool.contentType = 'mountain';
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
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
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

afterEach(() => useEditorStore.setState({ autoEdgeCut: 'off' }));

for (const mode of ['round', 'rect'] as const) {
  describe(`a freehand stroke trimmed as it is drawn (${mode})`, () => {
    for (const { name, path } of PATHS) {
      it(`ends in the same shape as ${name} trimmed once at the end`, () => {
        useEditorStore.setState({ autoEdgeCut: mode });
        const w = world();
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
      useEditorStore.setState({ autoEdgeCut: mode });
      const w = world();
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
      useEditorStore.setState({ autoEdgeCut: mode });
      const w = world();
      w.tool.onPointerDown({ x: 10, y: 10 }, MICRO, w.ctx);
      w.tool.onPointerMove({ x: 15, y: 10 }, MICRO, w.ctx);
      const cut = w.state.cells.flat().filter((c) => c?.terrain?.corners?.some((k) => k !== 'square')).length;
      expect(cut).toBeGreaterThan(0);
      w.tool.onPointerUp({ x: 15, y: 10 }, MICRO, w.ctx);
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
