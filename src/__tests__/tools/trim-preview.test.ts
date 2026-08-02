/**
 * The auto-trim preview: what the ghost promises has to be what the click produces.
 *
 * The one property worth testing is EQUALITY with the real thing — the preview runs the same trim
 * pass over a scratch grid, so every case is checked by painting the stroke for real and comparing
 * the map it leaves against the shapes the preview reported.
 */
import { describe, it, expect } from 'vitest';
import { previewAutoTrim, shapeOfCells, shapeOfSpans, terrainPaint, TRIM_PREVIEW_MAX_RIM } from '../../tools/edge-cut/trim-preview';
import { applyAutoEdgeCut } from '../../tools/edge-cut/auto-edge-cut';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type AutoEdgeCut, type EditorEvents, type GridState, type MacroCoord } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { circleCells, rectCells } from '../../tools/paint/shapes';

function world() {
  const state = makeState(30, 30);
  const registry = createDefaultRegistry();
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), registry);
  return { state, executor, rules: registry };
}

/** Every non-square (or trim-created) cell of a real map, in the preview's own shape. */
function shapesOf(state: GridState) {
  const out: string[] = [];
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    const t = cell?.terrain;
    if (!t || !t.corners) return;
    if (t.corners.every((c) => c === 'square') && !t.patchOnly) return;
    out.push(`${x},${y}:${t.corners.join('|')}${t.patchOnly ? ':patch' : ''}`);
  }));
  return out.sort();
}

/** Paint the cells for real, trim included, exactly as a committed stroke does. */
function paintForReal(w: ReturnType<typeof world>, cells: MacroCoord[], mode: AutoEdgeCut, elevation = 1) {
  w.executor.execute(terrainPaint(cells, TerrainType.Mountain, elevation));
  applyAutoEdgeCut({
    gridState: w.state,
    executeCommand: (cmd) => w.executor.execute(cmd),
  }, mode, cells, []);
}

/** The preview, in the same shape as `shapesOf`. */
function previewShapes(w: ReturnType<typeof world>, cells: MacroCoord[], mode: AutoEdgeCut, elevation = 1) {
  return previewAutoTrim(w.state, mode, shapeOfCells(cells), w.rules, () => [terrainPaint(cells, TerrainType.Mountain, elevation)])
    .map((c) => `${c.x},${c.y}:${c.corners.join('|')}${c.patch ? ':patch' : ''}`)
    .sort();
}

const SHAPES: { name: string; cells: MacroCoord[] }[] = [
  { name: 'a single cell', cells: [{ x: 10, y: 10 }] },
  { name: 'a 3x3 block', cells: rectCells({ x: 8, y: 8 }, { x: 10, y: 10 }) },
  { name: 'a disc', cells: circleCells({ x: 14, y: 14 }, 5, 5) },
  { name: 'an L, whose inner notch can gain a patch', cells: [...rectCells({ x: 6, y: 6 }, { x: 12, y: 8 }), ...rectCells({ x: 6, y: 9 }, { x: 8, y: 14 })] },
  { name: 'a diagonal staircase', cells: Array.from({ length: 8 }, (_, i) => [{ x: 5 + i, y: 5 + i }, { x: 6 + i, y: 5 + i }]).flat() },
];

for (const mode of ['round', 'rect'] as const) {
  describe(`preview vs the real stroke (${mode})`, () => {
    for (const { name, cells } of SHAPES) {
      it(`matches on ${name}`, () => {
        const predicted = previewShapes(world(), cells, mode);
        const real = world();
        paintForReal(real, cells, mode);
        expect(predicted).toEqual(shapesOf(real.state));
        expect(predicted.length, 'the case is only worth anything if the trim did something')
          .toBeGreaterThan(0);
      });
    }

    it('matches when the stroke lands against terrain that is already there', () => {
      // The corners of a stroke depend on what it meets, so a preview that only looked at the
      // stroke would be right on bare ground and wrong everywhere else.
      const wall = rectCells({ x: 12, y: 4 }, { x: 13, y: 20 });
      const stroke = circleCells({ x: 10, y: 12 }, 3, 3);
      const a = world(); paintForReal(a, wall, 'off');
      const predicted = previewShapes(a, stroke, mode);
      const b = world(); paintForReal(b, wall, 'off'); paintForReal(b, stroke, mode);
      expect(predicted).toEqual(shapesOf(b.state));
    });
  });
}

describe('what it reports', () => {
  it('leaves trim shapes that were already on the map out of it', () => {
    // A map is full of cut corners and Γ patches from earlier strokes. Reporting those as if this
    // preview had made them had the ghost drawing detached wedges, squares and whole circles over
    // terrain it is not touching.
    const w = world();
    paintForReal(w, rectCells({ x: 4, y: 4 }, { x: 14, y: 12 }), 'round');
    const standing = shapesOf(w.state);
    expect(standing.length, 'the background genuinely has trim shapes on it').toBeGreaterThan(0);
    const away = rectCells({ x: 22, y: 22 }, { x: 25, y: 25 });
    const reported = previewShapes(w, away, 'round');
    for (const cell of reported) {
      const [xy] = cell.split(':');
      const [x, y] = xy!.split(',').map(Number) as [number, number];
      expect(x, `reported ${xy}, which is nowhere near the stroke`).toBeGreaterThan(19);
      expect(y).toBeGreaterThan(19);
    }
  });

  it('but keeps a cut the stroke is about to make on ground that already has one', () => {
    const w = world();
    paintForReal(w, rectCells({ x: 4, y: 4 }, { x: 14, y: 12 }), 'round');
    // A stroke landing ON the existing mass: its own cells report their finished shape whether or
    // not the trim changed them, because the ghost draws the result, not the difference.
    const on = rectCells({ x: 6, y: 6 }, { x: 9, y: 9 });
    const reported = previewShapes(w, on, 'round', 2);
    expect(reported.length, 'the raised block rounds its own corners').toBeGreaterThan(0);
    for (const cell of reported) {
      const [x, y] = cell.split(':')[0]!.split(',').map(Number) as [number, number];
      expect(x >= 5 && x <= 10 && y >= 5 && y <= 10, `reported ${x},${y}`).toBe(true);
    }
  });
});

describe('the preview leaves the map alone', () => {
  it('changes nothing it was asked about', () => {
    const w = world();
    paintForReal(w, rectCells({ x: 4, y: 4 }, { x: 9, y: 9 }), 'off');
    const snapshot = JSON.stringify(w.state.cells);
    previewAutoTrim(w.state, 'round', shapeOfCells(circleCells({ x: 12, y: 12 }, 4, 4)), w.rules,
      () => [terrainPaint(circleCells({ x: 12, y: 12 }, 4, 4), TerrainType.Mountain, 1)]);
    expect(JSON.stringify(w.state.cells)).toBe(snapshot);
  });

  it('even where the commands it runs reach outside the cells it was asked about', () => {
    // A curve tweak previews the baseline restore FIRST, and that restore covers every cell the
    // curve has ever touched — far more than the scratch owns. Applied unclipped it edited the real
    // map behind the executor's back: no history, no redraw, and a stroke that then skipped those
    // cells because they already held what it was about to write.
    const w = world();
    const far = rectCells({ x: 2, y: 2 }, { x: 6, y: 6 });
    paintForReal(w, far, 'off');
    const cells = rectCells({ x: 25, y: 25 }, { x: 28, y: 28 });
    previewAutoTrim(w.state, 'round', shapeOfCells(cells), w.rules,
      () => [terrainPaint(cells, TerrainType.Mountain, 1)],
      [{ type: CommandType.EraseTerrain, timestamp: 0, cells: far }]);
    expect(far.filter((c) => w.state.cells[c.y]![c.x]!.terrain)).toHaveLength(far.length);
  });

  it('and does not hand out cells that share state with the live grid', () => {
    // A scratch that aliased the real cells would let a preview corrupt the map through a stray
    // write, which is the failure mode a copy-on-write slice exists to prevent.
    const w = world();
    paintForReal(w, rectCells({ x: 10, y: 10 }, { x: 12, y: 12 }), 'off');
    const live = w.state.cells[11]![11]!.terrain;
    previewAutoTrim(w.state, 'round', shapeOfCells([{ x: 11, y: 11 }]), w.rules, () => [terrainPaint([{ x: 11, y: 11 }], TerrainType.Mountain, 2)]);
    expect(w.state.cells[11]![11]!.terrain).toBe(live);
    expect(w.state.cells[11]![11]!.terrain!.elevation).toBe(1);
  });
});

describe('when there is nothing to show', () => {
  it('says so with the trim switched off', () => {
    const w = world();
    expect(previewShapes(w, circleCells({ x: 12, y: 12 }, 4, 4), 'off')).toEqual([]);
  });

  it('but a big shape is previewed like a small one — only its rim can be trimmed', () => {
    // The cost tracks the outline, not the area, so there is no size at which the ghost quietly
    // stops telling the truth.
    const w = world();
    const huge = rectCells({ x: 1, y: 1 }, { x: 28, y: 28 });
    expect(huge.length).toBeGreaterThan(400);
    expect(shapeOfCells(huge).rim.length).toBeLessThan(TRIM_PREVIEW_MAX_RIM);
    const predicted = previewShapes(w, huge, 'round');
    const real = world();
    paintForReal(real, huge, 'round');
    expect(predicted).toEqual(shapesOf(real.state));
  });

  it('and a span-form shape previews the same as its cells', () => {
    // rect / circle ghosts never build a cell list; the rim comes straight off the spans.
    const cells = rectCells({ x: 4, y: 4 }, { x: 20, y: 16 });
    const spans = [];
    for (let y = 4; y <= 16; y++) spans.push({ x: 4, y, w: 17 });
    const a = shapeOfCells(cells), b = shapeOfSpans(spans);
    const k = (c: { x: number; y: number }) => `${c.x},${c.y}`;
    expect(new Set(b.rim.map(k))).toEqual(new Set(a.rim.map(k)));
    for (const c of [{ x: 4, y: 4 }, { x: 12, y: 10 }, { x: 21, y: 10 }, { x: 12, y: 3 }]) {
      expect(b.contains(c.x, c.y), k(c)).toBe(a.contains(c.x, c.y));
    }
  });
});
