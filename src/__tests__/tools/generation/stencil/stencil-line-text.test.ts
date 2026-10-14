import { describe, expect, it } from 'vitest';
import { fitStrokeText } from '../../../../tools/generation/stencil/stencil-line-text';
import { sharpLineCorners } from '../../../../tools/generation/stencil/stencil-line-path';
import { wrapTextRows } from '../../../../tools/generation/stencil/stencil-text-layout';
import { strokeTileMask, strokeTilePalette } from '../../../../tools/generation/stencil/stencil-line-tiles';
import { getAllItems, getCatalogItem } from '../../../../state/catalog';
import { runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { fontModel } from './_text-fonts';
import { makeState, makeExecutor } from '../../../_support/map-state';

const glyph = (char: string) => {
  const model = fontModel(char);
  return { model, ascent: model.height, descent: 0, unitsPerPixel: 1 };
};

/** N/E/S/W exits (bits 0..3) after `turns` clockwise quarter turns: an exit on side `s` faces side
 *  `s + turns`. */
const turned = (mask: number, turns: number): number =>
  [0, 1, 2, 3].reduce((out, side) => (mask & (1 << side) ? out | (1 << ((side + turns) % 4)) : out), 0);

describe('connected line lettering', () => {
  it('uses available height for multiple rows with the same glyph size', () => {
    const s = fitStrokeText(Array.from({ length: 12 }, () => glyph('H')), { width: 36, height: 36 })!;
    expect(s).not.toBeNull();
    const occupiedRows = Array.from({ length: s.height }, (_, y) => s.coverage.subarray(y * s.width, (y + 1) * s.width).some(Boolean));
    const runs: number[] = [];
    occupiedRows.forEach((on, y) => { if (on) { if (!occupiedRows[y - 1]) runs.push(0); runs[runs.length - 1]!++; } });
    expect(runs.length).toBeGreaterThan(1);
    expect(new Set(runs).size).toBe(1);
    expect(runs.reduce((a, b) => a + b, 0)).toBeGreaterThan(24);
  });

  it('prefers word boundaries while wrapping an oversized word at grapheme boundaries', () => {
    const word = Array.from('HELLO WORLD');
    expect(wrapTextRows(word.length, 7, i => word[i] === ' ')).toEqual([{ start: 0, end: 5 }, { start: 6, end: 11 }]);
    expect(wrapTextRows(12, 4, () => false)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 12 }]);
  });

  it('uses equal advances and identical geometry for repeated glyphs', () => {
    const s = fitStrokeText([glyph('H'), glyph('H'), glyph('H')], { width: 54, height: 16 })!;
    expect(s).not.toBeNull();
    const columns = Array.from({ length: s.width }, (_, x) => s.coverage.some((v, i) => v > 0 && i % s.width === x));
    const runs: number[][] = [];
    columns.forEach((on, x) => { if (on) { if (!columns[x - 1]) runs.push([]); runs[runs.length - 1]!.push(x); } });
    expect(runs).toHaveLength(3);
    const strips = runs.map(run => Array.from({ length: s.height }, (_, y) => run.map(x => s.connections![y * s.width + x])));
    expect(strips[1]).toEqual(strips[0]);
    expect(strips[2]).toEqual(strips[0]);
    expect(runs[1]![0]! - runs[0]![runs[0]!.length - 1]!).toBe(runs[2]![0]! - runs[1]![runs[1]!.length - 1]!);
  });

  it('aligns uppercase letters to the same top and baseline rows', () => {
    const s = fitStrokeText(['H', 'E', 'L'].map(glyph), { width: 60, height: 20 })!;
    expect(s).not.toBeNull();
    const columns = Array.from({ length: s.width }, (_, x) => s.coverage.some((v, i) => v > 0 && i % s.width === x));
    const starts = columns.flatMap((on, x) => on && !columns[x - 1] ? [x] : []);
    const extents = starts.map((x, n) => {
      const end = starts[n + 1] ?? s.width;
      const rows = Array.from(s.coverage).flatMap((v, i) => v && i % s.width >= x && i % s.width < end ? [Math.floor(i / s.width)] : []);
      return [Math.min(...rows), Math.max(...rows)];
    });
    expect(extents).toHaveLength(3);
    expect(extents[1]).toEqual(extents[0]);
    expect(extents[2]).toEqual(extents[0]);
  });

  it.each([12, 24, 40])('keeps one line per stem at height %i with reciprocal connections', height => {
    const s = fitStrokeText([glyph('H')], { width: height, height })!;
    expect(s).not.toBeNull();
    const occupied = Array.from(s.coverage).filter(Boolean).length;
    expect(occupied).toBeLessThan(height * 4);
    const offsets = [-s.width, 1, s.width, -1];
    for (let i = 0; i < s.coverage.length; i++) for (let d = 0; d < 4; d++) if (s.connections![i]! & (1 << d)) {
      expect(s.connections![i + offsets[d]!]! & (1 << ((d + 2) % 4))).not.toBe(0);
    }
  });

  it.each(['M', 'N', 'V', 'W'])('keeps %s a single stroke without dead-end spurs in compact regions', char => {
    for (const height of [9, 12, 18]) {
      const stencil = fitStrokeText([glyph(char)], { width: height + 4, height })!;
      expect(stencil).not.toBeNull();
      const ends = [...stencil.connections!].filter(mask => mask !== 0 && (mask & (mask - 1)) === 0);
      expect(ends, `${char} at height ${height}`).toHaveLength(2);
    }
  });

  it('preserves both symmetry axes of a rounded counter', () => {
    const stencil = fitStrokeText([glyph('O')], { width: 20, height: 18 })!;
    const points = [...stencil.coverage].flatMap((v, i) => v ? [[i % stencil.width, Math.floor(i / stencil.width)]] : []);
    const xs = points.map(p => p[0]!), ys = points.map(p => p[1]!);
    const sx = Math.min(...xs) + Math.max(...xs), sy = Math.min(...ys) + Math.max(...ys);
    for (const [x, y] of points) {
      expect(stencil.coverage[y! * stencil.width + sx - x!]).toBe(255);
      expect(stencil.coverage[(sy - y!) * stencil.width + x!]).toBe(255);
    }
  });

  it('offers real catalog tiles for every joined direction and terminal', () => {
    const palette = strokeTilePalette(getAllItems());
    for (let mask = 0; mask < 16; mask++) {
      const effective = strokeTileMask(
        { width: 1, height: 1, coverage: new Uint8Array([255]), color: new Uint32Array(1), connections: new Uint8Array([mask]) }, 0,
      );
      const tile = palette.get(effective)!;
      expect(tile, String(mask)).toBeDefined();
      const item = getCatalogItem(tile.catalogId)!;
      expect(turned(item.strokeConnections!, tile.rotation / 90)).toBe(effective);
      expect(item.loadValue).toBe(0);
    }
  });

  it('places rotated prints through live rules in the allowed region and undoes them together', () => {
    const state = makeState(32, 32);
    const executor = makeExecutor(state);
    const stencil = fitStrokeText([glyph('H')], { width: 16, height: 16 })!;
    const origin = { x: 5, y: 5 };
    const allow = new Set(Array.from({ length: 16 * 16 }, (_, i) => (5 + Math.floor(i / 16)) * 32 + 5 + i % 16));
    const result = executor.transaction({}, tx => {
      const result = runStencilPlan(state, { read: 'shape', fill: { kind: 'stroke' }, stencil, origin, allow }, 3, cmd => executor.execute(cmd));
      tx.commit();
      return result;
    });
    expect(result.placed).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
    expect([...state.objects.values()].some(o => o.rotation !== 0)).toBe(true);
    expect([...state.objects.values()].every(o => allow.has(o.position.y * 32 + o.position.x))).toBe(true);
    executor.undo();
    expect(state.objects.size).toBe(0);
  });
});

describe('orthogonal print letterforms', () => {
  it.each([12, 24, 40, 80, 160, 300])('uses a small number of bends for diagonal stems at height %i', height => {
    const s = fitStrokeText([glyph('N')], { width: height, height })!;
    expect(s).not.toBeNull();
    const corners = [...s.connections!].filter(mask => [3, 6, 9, 12].includes(mask)).length;
    expect(corners).toBeLessThanOrEqual(8);
  });
});


describe('source-aware stroke materials', () => {
  it('keeps square source corners angular and diagonal turns rounded', () => {
    expect(sharpLineCorners([[[0, 0], [6, 0], [6, 6]]])).toEqual([[6, 0]]);
    expect(sharpLineCorners([[[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]]])).toEqual([[0, 0], [6, 0], [6, 6], [0, 6]]);
    expect(sharpLineCorners([[[0, 0], [6, 0], [3, 3], [3, 9]]])).toEqual([]);
  });

  it('offers all five field shapes with matching exits in both palettes', () => {
    const angular = strokeTilePalette(getAllItems()), curved = strokeTilePalette(getAllItems(), true);
    const used = new Set([...angular.values(), ...curved.values()].map(tile => tile.catalogId));
    expect(used).toEqual(new Set(['print-field-line', 'print-field-corner', 'print-field-arc', 'print-field-junction', 'print-field-cross']));
    for (const mask of [3, 6, 9, 12]) {
      expect(angular.get(mask)!.catalogId).toBe('print-field-corner');
      expect(curved.get(mask)!.catalogId).toBe('print-field-arc');
      const tile = curved.get(mask)!;
      expect(turned(getCatalogItem(tile.catalogId)!.strokeConnections!, tile.rotation / 90)).toBe(mask);
    }
  });

  it('carries curved ideographic strokes through real placement and undo', () => {
    const state = makeState(40, 40), executor = makeExecutor(state);
    const stencil = fitStrokeText([{ ...glyph('\u597d'), ideographic: true }], { width: 24, height: 24 })!;
    expect(stencil).not.toBeNull();
    const outcome = executor.transaction({}, tx => {
      const result = runStencilPlan(state, { read: 'shape', fill: { kind: 'stroke' }, stencil, origin: { x: 4, y: 4 } }, 3, cmd => executor.execute(cmd));
      expect(tx.commit()).toEqual([]);
      return result;
    });
    expect(outcome.skipped).toBe(0);
    expect([...state.objects.values()].some(o => o.catalogId === 'print-field-arc')).toBe(true);
    expect([...state.objects.values()].some(o => o.catalogId === 'print-field-corner')).toBe(true);
    executor.undo();
    expect(state.objects.size).toBe(0);
  });
});
