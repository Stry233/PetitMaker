/** One stroke, one layer: the brush, the eraser and the water brush take their layer from the cell
 *  the press starts on and work on that layer alone, and the layer panel shows it. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { brush, eraser, type Pointer } from './_editing';
import type { MacroCoord } from '../../../core/model/types';
import type { BuildShape } from '../../../state/editing/vocabulary';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { isLegalMap } from '../../../rules/legality';
import { seeded } from './_sequences';

const at = (o: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: o.x + dx, y: o.y + dy });

/** Mountain stacked on `cells` up to `elevation`, a layer at a time. */
function raise(w: SpecWorld, cells: readonly MacroCoord[], elevation: number): void {
  for (let e = 1; e <= elevation; e++) expect(w.stroke(cells, TerrainType.Mountain, e).ok, `layer ${e}`).toBe(true);
}

/** Each cell's surface height, 0 for open ground. */
const heights = (w: SpecWorld, cells: readonly MacroCoord[]): number[] => cells.map((c) => surfaceElevation(w.state.cells[c.y]![c.x]!.terrain));

/** The layers the panel was set to after the press at index `from` of `p.shownLayers`. */
const shownSince = (p: Pointer, from: number): (number | null)[] => p.shownLayers.slice(from);

/**
 * A stepped hill on 15 by 15 cells: layers up to elevation 3 cover it all, then each layer up to 6
 * is one cell smaller on every side, and the top holds a 3 by 3 basin one layer down. `top` is a
 * cell of the top, `basin` the basin's centre and `lip` the top cell left of the basin.
 */
function hill(w: SpecWorld): { area: MacroCoord[]; top: MacroCoord; lip: MacroCoord; basin: MacroCoord } {
  const o = w.openGround(15, 15);
  const area = rect(o, 15, 15);
  raise(w, area, 3);
  for (let e = 4; e <= 6; e++) {
    const inset = e - 3;
    const ring = rect(at(o, inset, inset), 15 - 2 * inset, 15 - 2 * inset);
    const basin = new Set(rect(at(o, 8, 6), 3, 3).map((c) => `${c.x},${c.y}`));
    expect(w.stroke(e === 6 ? ring.filter((c) => !basin.has(`${c.x},${c.y}`)) : ring, TerrainType.Mountain, e).ok, `layer ${e}`).toBe(true);
  }
  return { area, top: at(o, 4, 7), lip: at(o, 7, 7), basin: at(o, 9, 7) };
}

describe('one stroke, one layer', () => {
  spec('EDIT-05', 'a brush stroke over mixed heights raises only the cells one below its start layer, and never stacks', () => {
    const w = world();
    const o = w.openGround(8, 3);
    const row = rect(at(o, 0, 1), 8, 1);
    // Heights along the row: 0 1 2 1 0 1 3 1
    raise(w, [row[1]!, row[3]!, row[5]!, row[7]!], 1);
    raise(w, [row[2]!], 2);
    raise(w, [row[6]!], 3);
    const p = brush(w);
    p.drag(row[1]!, ...row.slice(2), ...row.slice(0, 1));
    expect(p.toasts).toEqual([]);
    expect(heights(w, row), 'pressed on layer 1, the stroke adds layer 2 only where layer 1 stands').toEqual([0, 2, 2, 2, 0, 2, 3, 2]);

    brush(w).drag(row[0]!, ...row.slice(1));
    expect(heights(w, row), 'pressed on open ground, it adds layer 1 only on open ground').toEqual([1, 2, 2, 2, 1, 2, 3, 2]);
  });

  spec('EDIT-06', 'cells at or above the stroke\'s layer stay as they are, however often the stroke crosses them', () => {
    const w = world();
    const o = w.openGround(6, 3);
    const row = rect(at(o, 0, 1), 6, 1);
    raise(w, row.slice(2, 4), 1);
    const p = brush(w);
    p.drag(row[0]!, row[5]!, row[0]!, row[5]!);
    expect(heights(w, row)).toEqual([1, 1, 1, 1, 1, 1]);
    p.click(row[2]!);
    expect(heights(w, row), 'a new press on a cell builds on its own top').toEqual([1, 1, 2, 1, 1, 1]);
  });

  spec('EDIT-06', 'a stroke never fills a column under a cell more than one layer below it', () => {
    const w = world();
    const o = w.openGround(5, 3);
    const row = rect(at(o, 0, 1), 5, 1);
    raise(w, row.slice(0, 2), 2);
    brush(w).drag(row[0]!, row[4]!);
    expect(heights(w, row)).toEqual([3, 3, 0, 0, 0]);
  });

  spec('EDIT-02', 'a line, rectangle, circle or curve works on the layer its press starts on', () => {
    for (const shape of ['line', 'rect', 'circle', 'curve'] as const satisfies readonly BuildShape[]) {
      const w = world();
      const o = w.openGround(9, 9);
      const area = rect(o, 9, 9);
      const block = rect(at(o, 3, 3), 3, 3);
      raise(w, block, 1);
      const draw = (p: Pointer, from: MacroCoord, to: MacroCoord) => {
        if (shape === 'curve') { p.click(from); p.click(to); p.doubleClick(to); }
        else p.drag(from, to);
      };
      const before = heights(w, area);
      draw(brush(w, { shape }), at(o, 4, 4), at(o, 8, 4));
      const onBlock = heights(w, area);
      for (let i = 0; i < area.length; i++) {
        const was = before[i]!, now = onBlock[i]!;
        expect(now === was || (was === 1 && now === 2), `${shape} pressed on layer 1: cell ${i} went ${was} to ${now}`).toBe(true);
      }
      expect(onBlock[area.findIndex((c) => c.x === o.x + 4 && c.y === o.y + 4)], `${shape} raises the block it starts on`).toBe(2);

      draw(brush(w, { shape }), at(o, 0, 4), at(o, 8, 4));
      const fromGround = heights(w, area);
      for (let i = 0; i < area.length; i++) {
        const was = onBlock[i]!, now = fromGround[i]!;
        expect(now === was || (was === 0 && now === 1), `${shape} pressed on open ground: cell ${i} went ${was} to ${now}`).toBe(true);
      }
      expect(fromGround.filter((h, i) => h !== onBlock[i]!).length, `${shape} lays open ground`).toBeGreaterThan(0);
    }
  });

  spec('EDIT-11', 'the mountain eraser takes only the layer its press starts on', () => {
    const w = world();
    const o = w.openGround(6, 3);
    const row = rect(at(o, 0, 1), 6, 1);
    // Heights along the row: 1 2 3 2 1 2
    raise(w, row, 1);
    raise(w, [row[1]!, row[2]!, row[3]!, row[5]!], 2);
    raise(w, [row[2]!], 3);
    const e = eraser(w);
    e.drag(row[1]!, ...row.slice(2), row[0]!);
    expect(e.toasts).toEqual([]);
    expect(heights(w, row)).toEqual([1, 1, 3, 1, 1, 1]);
    eraser(w, { eraserShape: 'rect' }).drag(row[2]!, row[0]!);
    expect(heights(w, row), 'a rectangle from the layer-3 cell takes layer 3 alone').toEqual([1, 1, 2, 1, 1, 1]);
  });

  spec('EDIT-11', 'the water eraser takes only water at the layer its press starts on', () => {
    const w = world();
    const o = w.openGround(9, 5);
    const terrace = rect(o, 5, 5);
    raise(w, terrace, 1);
    const pool = at(o, 2, 2);
    const puddle = at(o, 7, 2);
    brush(w, { contentType: 'water' }).click(pool);
    brush(w, { contentType: 'water' }).click(puddle);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Water, elevation: 1 });
    expect(w.terrainAt(puddle)).toEqual({ type: TerrainType.Water, elevation: 0 });
    eraser(w, { contentType: 'water', eraserShape: 'line' }).drag(puddle, pool);
    expect(w.terrainAt(puddle)).toBeNull();
    expect(w.terrainAt(pool), 'the pool on layer 2 stays').toEqual({ type: TerrainType.Water, elevation: 1 });
  });

  spec('EDIT-08', 'water lies at the height its press starts on, only on ground or blocks of that height', () => {
    const w = world();
    const o = w.openGround(12, 5);
    raise(w, rect(o, 8, 5), 1);
    raise(w, rect(o, 4, 5), 2);
    const row = rect(at(o, 0, 2), 12, 1);
    const before = heights(w, row);
    const p = brush(w, { contentType: 'water' });
    p.drag(row[1]!, row[2]!, row[3]!, row[4]!, row[5]!, row[9]!, row[10]!);
    expect(p.toasts).toEqual([]);
    expect(heights(w, row), 'no cell changes height').toEqual(before);
    for (const c of row) {
      const t = w.terrainAt(c);
      const expected = c.x >= o.x + 1 && c.x <= o.x + 3 ? { type: TerrainType.Water, elevation: 2 } : t?.type === TerrainType.Water ? null : t;
      expect(t, `cell ${c.x - o.x}`).toEqual(expected);
    }
  });

  // The player's three cases: the stroke starts on the hill's layer-7 top and runs into a basin one
  // layer down, with the panel showing layer 9 or 10, 8 or 6 before the press.
  for (const [before, picked] of [['layer 9', 9], ['layer 10', 10], ['layer 8', 8], ['layer 6', 6]] as const) {
    spec('EDIT-08', `water never lowers a mountain or lands on another layer, with the panel showing ${before} before the press`, () => {
      const w = world();
      const { area, top, lip, basin } = hill(w);
      const was = heights(w, area);
      const p = brush(w, { contentType: 'water' });
      p.shownLayer = picked - 1;
      const mark = p.shownLayers.length;
      const path = [top, at(top, 1, 0), at(top, 2, 0), lip, at(lip, 1, 0), basin];
      p.drag(...path);
      expect(p.toasts).toEqual([]);
      expect(heights(w, area), 'every cell keeps its height').toEqual(was);
      for (const c of path.slice(0, 4)) expect(w.terrainAt(c), `top ${c.x - top.x}`).toEqual({ type: TerrainType.Water, elevation: 6 });
      for (const c of path.slice(4)) expect(w.terrainAt(c), 'the basin keeps its block').toEqual({ type: TerrainType.Mountain, elevation: 5 });
      expect(new Set(shownSince(p, mark)), 'the panel shows layer 7 from press to release').toEqual(new Set([6]));
    });
  }

  spec('EDIT-79', 'the layer panel shows the layer a stroke works on from its press to its end, whatever it showed before', () => {
    const w = world();
    const o = w.openGround(6, 3);
    const row = rect(at(o, 0, 1), 6, 1);
    raise(w, row.slice(0, 3), 2);
    const cases: [string, () => Pointer, number][] = [
      ['the brush pressed on layer 3 builds layer 4', () => brush(w), 3],
      ['the water brush pressed on layer 3 lays water on layer 3', () => brush(w, { contentType: 'water' }), 2],
      ['the eraser pressed on layer 3 takes layer 3', () => eraser(w), 2],
    ];
    for (const [what, pointer, layer] of cases) {
      const p = pointer();
      p.shownLayer = 0;
      const mark = p.shownLayers.length;
      p.press(row[1]!);
      expect(p.shownLayer, `${what}: at the press`).toBe(layer);
      p.move(row[4]!);
      p.move(row[5]!);
      p.release(row[5]!);
      expect(new Set(shownSince(p, mark)), `${what}: through the stroke`).toEqual(new Set([layer]));
      w.undo();
    }
  });

  spec('EDIT-05', 'a thickness of 2 started on layer 5 raises cells at layers 5 and 6 to layer 7, and leaves layer 4 and layer 7 and up alone', () => {
    const w = world();
    const o = w.openGround(9, 5);
    raise(w, rect(o, 9, 5), 3);
    const row = rect(at(o, 1, 2), 7, 1);
    // Heights along the row: 3 4 5 6 4 3 5, on a plateau of 3.
    for (const [i, h] of [[1, 4], [2, 5], [3, 6], [4, 4], [6, 5]] as const) {
      for (let e = 4; e <= h; e++) expect(w.stroke([row[i]!], TerrainType.Mountain, e).ok).toBe(true);
    }
    const p = brush(w, { terrainThickness: 2 });
    p.drag(row[1]!, ...row.slice(2), row[0]!);
    expect(p.toasts).toEqual([]);
    expect(heights(w, row)).toEqual([3, 6, 6, 6, 6, 3, 6]);
    expect(p.shownLayer, 'the panel shows the top it builds').toBe(6);
  });

  spec('EDIT-11', 'a thickness of 2 started on layer 5 lowers cells at layers 4 and 5 to layer 3, and leaves layer 3 and down and layer 6 and up alone', () => {
    const w = world();
    const o = w.openGround(9, 5);
    raise(w, rect(o, 9, 5), 2);
    const row = rect(at(o, 1, 2), 7, 1);
    // Heights along the row: 2 3 4 5 4 2 3, on a plateau of 2.
    for (const [i, h] of [[1, 3], [2, 4], [3, 5], [4, 4], [6, 3]] as const) {
      for (let e = 3; e <= h; e++) expect(w.stroke([row[i]!], TerrainType.Mountain, e).ok).toBe(true);
    }
    const e = eraser(w, { terrainThickness: 2 });
    e.drag(row[2]!, ...row.slice(3), row[1]!, row[0]!);
    expect(e.toasts).toEqual([]);
    expect(heights(w, row)).toEqual([2, 2, 2, 5, 2, 2, 2]);
    expect(e.shownLayer, 'the panel shows the top it starts from').toBe(4);
  });

  spec('EDIT-11', 'the eraser never takes the ground, whatever its thickness', () => {
    const w = world();
    const o = w.openGround(4, 3);
    const row = rect(at(o, 0, 1), 4, 1);
    raise(w, row.slice(0, 2), 1);
    const before = w.fingerprint();
    eraser(w, { terrainThickness: 3 }).drag(row[0]!, row[3]!);
    expect(heights(w, row)).toEqual([0, 0, 0, 0]);
    w.undo();
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-79', 'the brush pressed on water shows the water\'s own layer, the one it turns into mountain', () => {
    const w = world();
    const o = w.openGround(5, 5);
    raise(w, rect(o, 5, 5), 2);
    const pool = at(o, 2, 2);
    brush(w, { contentType: 'water' }).click(pool);
    const p = brush(w);
    p.click(pool);
    expect(p.shownLayer).toBe(2);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  spec('EDIT-07', 'a stroke whose new layer lacks the support the rules ask for is not laid, and the editor names the rule', () => {
    const w = world();
    const o = w.openGround(3, 3);
    raise(w, [o], 3);
    const before = w.fingerprint();
    const p = brush(w);
    p.click(o);
    expect(w.fingerprint()).toBe(before);
    expect(p.toasts).toEqual(['Base rule: need 3x3 support within 3 layers below']);
  });

  spec('EDIT-05', 'whatever the strokes, the map stays within the rules', () => {
    const shapes: BuildShape[] = ['free', 'line', 'rect', 'circle'];
    for (let seed = 1; seed <= 4; seed++) {
      const r = seeded(seed);
      const int = (n: number) => Math.floor(r() * n);
      const w = world();
      const o = w.openGround(10, 10);
      const cell = () => at(o, int(10), int(10));
      for (let i = 0; i < 30; i++) {
        const shape = shapes[int(shapes.length)]!;
        const roll = r();
        const p = roll < 0.55 ? brush(w, { shape, brushSize: 1 + int(3) })
          : roll < 0.75 ? brush(w, { shape, contentType: 'water', brushSize: 1 + int(2) })
          : eraser(w, { eraserShape: shape, contentType: r() < 0.8 ? 'mountain' : 'water', brushSize: 1 + int(2) });
        p.drag(cell(), cell(), cell());
        expect(isLegalMap(w.state, w.sandbox.executor.getRegistry()), `seed ${seed}, stroke ${i}`).toBe(true);
      }
    }
  });
});
