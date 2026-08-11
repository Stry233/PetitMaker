import { describe, it, expect } from 'vitest';
import { layersFor, paintLayer } from '../../../io/export/layer-preview';
import { CellZone, TerrainType, type GridState, type MacroCell, type PlacedObject } from '../../../core/model/types';

/** A `CanvasRenderingContext2D` stand-in with no real canvas: every path/state method is a
 *  no-op, `fillRect` records its call alongside whatever `fillStyle` was set immediately before
 *  it (a real context reads `fillStyle` at fill time too), which is all `paintLayer` needs. */
function fakeCtx(): CanvasRenderingContext2D & { calls: { x: number; y: number; w: number; h: number; fillStyle: unknown }[] } {
  let fillStyle: unknown = '#000';
  const calls: { x: number; y: number; w: number; h: number; fillStyle: unknown }[] = [];
  const noop = () => {};
  return {
    save: noop, restore: noop, clip: noop, beginPath: noop, moveTo: noop, arcTo: noop, closePath: noop,
    get fillStyle() { return fillStyle; },
    set fillStyle(v: unknown) { fillStyle = v; },
    set globalAlpha(_v: number) {},
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ x, y, w, h, fillStyle }); },
    calls,
  } as unknown as CanvasRenderingContext2D & { calls: { x: number; y: number; w: number; h: number; fillStyle: unknown }[] };
}

/** Build a tiny GridState whose cells carry the given (type, elevation) so we can probe the
 *  construction-step derivation directly. `peaks` is a flat list painted onto a 4x3 grass grid. */
function makeState(peaks: { type: TerrainType; elevation: number }[]): GridState {
  const width = 4, height = 3;
  const cells: MacroCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: MacroCell[] = [];
    for (let x = 0; x < width; x++) row.push({ zone: CellZone.Grass, terrain: null });
    cells.push(row);
  }
  // Drop the peaks onto the first cells, row-major.
  let i = 0;
  for (const p of peaks) {
    const y = Math.floor(i / width), x = i % width;
    if (cells[y]?.[x]) cells[y]![x] = { zone: CellZone.Grass, terrain: { type: p.type, elevation: p.elevation } };
    i++;
  }
  return {
    template: { id: 't', name: { en: 't' }, width, height, zones: [], plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 } },
    cells,
    objects: new Map(),
    lockedLayers: new Set(),
  };
}

describe('layersFor (construction sequence)', () => {
  it('all-ground map → a single ground step', () => {
    const steps = layersFor(makeState([]));
    expect(steps).toEqual([{ level: 0, labelKey: 'export.layer_ground' }]);
  });

  it('max mountain elevation 3 → 4 steps, level 0..3', () => {
    const steps = layersFor(makeState([
      { type: TerrainType.Mountain, elevation: 1 },
      { type: TerrainType.Mountain, elevation: 3 },
      { type: TerrainType.Mountain, elevation: 2 },
    ]));
    expect(steps.map((s) => s.level)).toEqual([0, 1, 2, 3]);
    expect(steps[0]!.labelKey).toBe('export.layer_ground');
    expect(steps[1]!.labelKey).toBe('export.layer_level');
    expect(steps[3]!.labelKey).toBe('export.layer_level');
  });

  it('water elevation also drives the max level', () => {
    const steps = layersFor(makeState([{ type: TerrainType.Water, elevation: 2 }]));
    expect(steps.map((s) => s.level)).toEqual([0, 1, 2]);
  });

  it('caps at ELEVATION_MAX (8) even if a cell somehow exceeds it', () => {
    const steps = layersFor(makeState([{ type: TerrainType.Mountain, elevation: 20 }]));
    expect(steps[steps.length - 1]!.level).toBe(8);
    expect(steps).toHaveLength(9); // levels 0..8
  });
});

describe('paintLayer: object draw position', () => {
  it('draws a half-anchored object at its EXACT position, not the cell its rounded position lands on', () => {
    // 4x3 map, rect matches the map aspect exactly so fit is the plain rect and cellW = cellH =
    // 100: a half-anchored deck (issue #4) at x = 2.5 must draw at fit.x + 250, not at
    // Math.round(2.5) * 100 = 300 (the wrong neighbour cell).
    const state = makeState([]);
    const deck: PlacedObject = { id: 'd', catalogId: 'nope', position: { x: 2.5, y: 1 }, width: 1, height: 1, rotation: 0, elevation: 0 };
    state.objects.set('d', deck);
    const ctx = fakeCtx();
    paintLayer(ctx, { x: 0, y: 0, w: 400, h: 300 }, state, 0, 4 / 3);

    const objectCalls = ctx.calls.filter((c) => c.fillStyle === '#e6c48a'); // objectColor's fallback for an unknown catalogId
    expect(objectCalls).toHaveLength(1);
    expect(objectCalls[0]).toMatchObject({ x: 250, y: 100 });
  });
});
