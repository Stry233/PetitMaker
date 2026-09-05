import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { ItemCategory, TerrainType, type EditorEvents, type Stencil, type StencilPlan } from '../../../../core/model/types';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { getCatalogByCategory } from '../../../../state/catalog';
import { generateTerrain } from '../../../../tools/generation/terrain-generator';
import { fitTextGrid, textTopology, textStrokeEnds } from '../../../../tools/generation/stencil/stencil-text-grid';
import { fontModel } from './_text-fonts';
import { makeState } from '../../../rules/_helpers';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const box = (width: number, height = width) => ({ width, height });
const rasterize = (text: string, frame: { width: number; height: number }): Stencil | null => fitTextGrid(fontModel(text), frame)?.stencil ?? null;
const rowsOf = (s: Stencil): string[] => Array.from({ length: s.height }, (_, y) =>
  Array.from(s.coverage.slice(y * s.width, (y + 1) * s.width), (c) => c ? '#' : '.').join(''));

function build(stencil: Stencil, fill: StencilPlan['fill'], read: StencilPlan['read'] = 'shape', allow?: Set<number>) {
  const state = makeState(stencil.width + 6, stencil.height + 6);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const result = generateTerrain({
    algorithm: 'stencil', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed: 1, region: null,
    stencilPlan: { read, fill, stencil, origin: { x: 3, y: 3 }, allow },
  }, state, (c) => exec.execute(c), exec.getRegistry());
  expect(exec.commitStrokeGroup(0)).toEqual([]);
  return { state, result };
}

describe('font-derived text layout', () => {
  it.each([...ALPHANUMERIC])('retains the strokes and counters of %s in small rectangles', text => {
    const model = fontModel(text);
    for (const frame of [box(5), box(5, 6), box(6, 5), box(6)]) {
      const result = fitTextGrid(model, frame)!;
      expect(result.ok, `${frame.width}×${frame.height}`).toBe(true);
      expect(textTopology(result.stencil.coverage, frame.width, frame.height)).toEqual({ pieces: model.pieces, counters: model.counters });
      expect(result.stencil.cellAligned).toBe(true);
      expect(new Set(result.stencil.coverage)).toEqual(new Set([0, 255]));
    }
  });

  it('re-fits strokes to each row and column instead of reusing one small bitmap', () => {
    const square = rasterize('W', box(5))!;
    const taller = rasterize('W', box(5, 6))!;
    const wider = rasterize('W', box(6, 5))!;
    expect(rowsOf(taller).every(row => row.includes('#'))).toBe(true);
    expect(taller.coverage.slice(0, 25)).not.toEqual(square.coverage);
    expect(rowsOf(wider).every(row => row.length === 6)).toBe(true);
    expect(rowsOf(wider)[0]).toBe('#....#');
    for (let size = 5; size <= 14; size++) {
      expect(fitTextGrid(fontModel('W'), box(size))?.ok, String(size)).toBe(true);
      expect(fitTextGrid(fontModel('a'), box(size))?.ok, String(size)).toBe(true);
    }
  });

  it('keeps distinguishing stems, dots and counters', () => {
    for (const [a, b] of [['a', 'o'], ['i', 'j'], ['0', 'O'], ['8', 'B']]) {
      expect(rowsOf(rasterize(a!, box(5))!)).not.toEqual(rowsOf(rasterize(b!, box(5))!));
    }
    expect(textTopology(rasterize('8', box(5))!.coverage, 5, 5).counters).toBe(2);
    expect(textTopology(rasterize('j', box(5))!.coverage, 5, 5).pieces).toBe(2);
  });

  it('uses font geometry for characters outside the Latin alphabet', () => {
    expect(fitTextGrid(fontModel('Я'), box(5))?.ok).toBe(true);
    expect(fitTextGrid(fontModel('é'), box(9))?.ok).toBe(true);
    expect(fitTextGrid(fontModel('é'), box(5))?.ok).toBe(false);
    expect(fitTextGrid(fontModel('谷'), box(5))?.ok).toBe(false);
  });

  it('keeps a mixed-script word readable as its region grows', () => {
    for (let height = 9; height <= 14; height++) {
      expect(fitTextGrid(fontModel('A谷'), box(height * 2, height))?.ok, String(height)).toBe(true);
    }
  });

  it('refuses a mixed-script fit that loses open branches despite retaining its counters', () => {
    for (let height = 5; height <= 8; height++) {
      expect(fitTextGrid(fontModel('A谷'), box(height * 2, height))?.ok, String(height)).toBe(false);
    }
  });

  it.each(['木', '土', '工'])('retains the open strokes of %s', text => {
    const model = fontModel(text);
    for (const height of [8, 10, 12, 16]) {
      const result = fitTextGrid(model, box(height))!;
      expect(result.ok).toBe(true);
      expect(textStrokeEnds(result.stencil.coverage, height, height)).toBeGreaterThanOrEqual(model.ends - 1);
    }
  });

  it.each(['地', '坊', '好', '愛', '林', '森'])('rejects collapsed strokes of %s in five cells', text => {
    expect(fitTextGrid(fontModel(text), box(5))?.ok).not.toBe(true);
  });

  it('fits complete words with empty columns between letters', () => {
    for (const text of ['Hello', 'W i', '2026']) {
      const model = fontModel(text);
      const result = fitTextGrid(model, { width: model.minimum.width, height: 7 })!;
      expect(result.ok, text).toBe(true);
      const rows = rowsOf(result.stencil);
      const empty = Array.from({ length: result.stencil.width }, (_, x) => rows.every(row => row[x] === '.')).filter(Boolean).length;
      expect(empty).toBeGreaterThanOrEqual(model.gaps.reduce((a, b) => a + b, 0));
      expect(fitTextGrid(model, { width: model.minimum.width - 1, height: 20 })).toBeNull();
    }
    expect(fontModel('W i').gaps[0]).toBeGreaterThanOrEqual(2);
  });

  it('shares a baseline while retaining lowercase height and descenders', () => {
    const rows = rowsOf(rasterize('Ag', box(15, 12))!);
    const split = Array.from({ length: 15 }, (_, x) => x).find(x => rows.every(row => row[x] === '.'))!;
    const left = rows.map((row, y) => row.slice(0, split).includes('#') ? y : -1).filter(y => y >= 0);
    const right = rows.map((row, y) => row.slice(split + 1).includes('#') ? y : -1).filter(y => y >= 0);
    expect(left[0]).toBeLessThan(right[0]!);
    expect(left[left.length - 1]).toBeLessThan(right[right.length - 1]!);
  });

  it('rejects regions below the brush floor and fractional cells', () => {
    for (const frame of [box(4), box(8, 4), box(5.5)]) expect(fitTextGrid(fontModel('W'), frame)).toBeNull();
  });
});

describe('font-derived text on the map', () => {
  it('places one selected object on each ink cell', () => {
    const item = getCatalogByCategory(ItemCategory.Flora).find((entry) => entry.width === 1 && entry.height === 1)!;
    const stencil = rasterize('W', box(5))!;
    const { state, result } = build(stencil, { kind: 'object', catalogId: item.id });
    expect(result.skipped).toBe(0);
    expect(state.objects.size).toBe(stencil.coverage.filter((c) => c > 0).length);
    for (const object of state.objects.values()) {
      expect(object.catalogId).toBe(item.id);
      expect(stencil.coverage[(object.position.y - 3) * 5 + object.position.x - 3]).toBe(255);
    }
  });

  it.each([TerrainType.Mountain, TerrainType.Water])('preserves every cell and counter with terrain %s', (terrain) => {
    for (const text of ALPHANUMERIC) {
      const stencil = rasterize(text, box(5))!;
      const { state, result } = build(stencil, { kind: 'terrain', terrain });
      expect(result.skipped, text).toBe(0);
      expect(result.placed, text).toBe(stencil.coverage.filter((c) => c > 0).length);
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        const t = state.cells[y + 3]![x + 3]!.terrain;
        expect(t?.type ?? 0, `${text} ${x},${y}`).toBe(stencil.coverage[y * 5 + x] ? terrain : 0);
        expect(t?.patchOnly ?? false, text).toBe(false);
        expect(t?.corners?.some(Boolean) ?? false, text).toBe(false);
      }
    }
  });

  it('respects the painted region inside its bounding box', () => {
    const stencil = rasterize('W', box(5))!;
    const allow = new Set(Array.from({ length: 5 }, (_, y) => (y + 3) * 11 + 3));
    const { state } = build(stencil, { kind: 'terrain', terrain: TerrainType.Mountain }, 'shape', allow);
    state.cells.forEach((row, y) => row.forEach((cell, x) => {
      if (cell.terrain) expect(allow.has(y * 11 + x)).toBe(true);
    }));
  });

  it('keeps picture placement and corner treatment independent of the text flag', () => {
    const stencil = rasterize('W', box(5))!;
    stencil.quad = Uint8Array.from({ length: 100 }, (_, i) => stencil.coverage[Math.floor(i / 4)]!);
    stencil.color.fill(0x587347);
    const picture = build({ ...stencil, cellAligned: undefined }, undefined, 'color');
    const flagged = build(stencil, undefined, 'color');
    expect(flagged.result).toEqual(picture.result);
    expect(flagged.state.cells).toEqual(picture.state.cells);
  });
});
