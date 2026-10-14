// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CellZone } from '../../../../core/game/zones';
import { TerrainType, type GridState, type MapTemplate } from '../../../../core/model/types';
import { createGrid } from '../../../../core/model/grid-model';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { bandGeometry } from '../../../../core/grid/map-chunks';
import { mapNativePx } from '../../../../io/export/sizing';
import { canonicalBytes, canonicalize } from '../../../../io/save/canonical';
import { renderProcPackAsync, takeSeed } from '../../../../pipelines/stylize/proc/render';
import { PROC_PACK_META, procPack, isProcPackId } from '../../../../pipelines/stylize/proc/packs';
import type { ProcView } from '../../../../pipelines/stylize/proc/draw';
import { STYLE_PACKS, CUSTOM_DIRECTION_ID } from '../../../../pipelines/stylize/presets';
import { validatePalette } from '../../../../pipelines/stylize/proc/palette';

function template(w = 20, h = 14): MapTemplate {
  const zones: CellZone[][] = [];
  for (let y = 0; y < h; y++) {
    const row: CellZone[] = [];
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      row.push(edge === 0 ? CellZone.Void : edge === 1 ? CellZone.Beach : CellZone.Grass);
    }
    zones.push(row);
  }
  return { id: 't', name: { en: 'T' }, width: w, height: h, zones } as unknown as MapTemplate;
}
function state(): GridState {
  const t = template();
  return { template: t, cells: createGrid(t), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set<number>() };
}

/** Every shipped pack, in the shelf's order. */
const PACKS = PROC_PACK_META.map((meta) => procPack(meta.id)!);

afterEach(() => { vi.restoreAllMocks(); });

describe('band geometry — the one frame two renderers must agree on', () => {
  it('keeps the capturerect half-cell bleed on top and left', () => {
    const band = bandGeometry({ width: 169, height: 140 });
    expect(band.originX).toBe(-0.5);
    expect(band.originY).toBe(-0.5);
    expect(band.widthCells).toBe(169.5);
    expect(band.heightCells).toBe(140.5);
  });

  it('reproduces the pixel size the 2D capture asks for, exactly', () => {
    // MapRenderer.captureImage frames (-half, -half, w*Tile + half, h*Tile + half).
    for (const t of [{ width: 169, height: 140 }, { width: 20, height: 14 }, { width: 1, height: 1 }]) {
      const half = TILE_SIZE / 2;
      expect(mapNativePx(t)).toEqual({ w: t.width * TILE_SIZE + half, h: t.height * TILE_SIZE + half });
    }
  });

  it('a procedural view spans the same band, so composed ink cannot land off by half a cell', async () => {
    const s = state();
    // The pack draws through the view it is handed; a 2D context of nothing lets the draw run here.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    const pack = PACKS.find((p) => !p.drawAsync)!;
    let v: ProcView | undefined;
    vi.spyOn(pack, 'draw').mockImplementation((_ctx, _fields, view) => { v = view; });
    await renderProcPackAsync({ state: s, packId: pack.id, maxPx: 400, seed: 1 });
    if (!v) throw new Error('the pack was not drawn');
    const band = bandGeometry(s.template);
    expect(v.x0).toBe(band.originX);
    expect(v.y0).toBe(band.originY);
    expect(v.cellsW).toBe(band.widthCells);
    expect(v.cellsH).toBe(band.heightCells);
    expect(Math.max(v.cellsW, v.cellsH) * v.pxPerCell).toBeCloseTo(400, 6);
  });
});

describe('the pack registry', () => {
  it('shares no id with the model directions — one id, one row, one meaning', () => {
    const model = new Set<string>([...STYLE_PACKS.map((p) => p.id), CUSTOM_DIRECTION_ID]);
    for (const pack of PACKS) expect(model.has(pack.id)).toBe(false);
  });

  it('holds every pack under a unique id, each one the shelf names', () => {
    expect(PACKS.every((p, i) => p?.id === PROC_PACK_META[i]!.id)).toBe(true);
    const ids = PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('resolves an id and rejects one it does not know', () => {
    for (const p of PACKS) expect(procPack(p.id)).toBe(p);
    expect(procPack('no-such-pack')).toBeUndefined();
    expect(isProcPackId('no-such-pack')).toBe(false);
  });

  it('EVERY pack passes the value rules — the defect cannot enter by the back door', () => {
    for (const pack of PACKS) {
      expect({ id: pack.id, problems: validatePalette(pack.palette) }).toEqual({ id: pack.id, problems: [] });
    }
  });

  it('every pack declares an i18n key and a cost bucket', () => {
    for (const pack of PACKS) {
      expect(pack.nameKey).toMatch(/^stylize\.proc_/);
      expect(pack.cost).toBeGreaterThanOrEqual(1);
      expect(pack.cost).toBeLessThanOrEqual(5);
    }
  });
});

const canon = (s: GridState): Uint8Array => canonicalBytes(canonicalize(s));

describe('takeSeed — one seed per roll of a style', () => {
  it('roll 0 is the map\'s own seed: the same canonical map always draws it, another map another', () => {
    const s = state();
    expect(takeSeed(state(), 0, canon)).toBe(takeSeed(s, 0, canon));
    const changed = state();
    changed.cells[5]![5]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
    expect(takeSeed(changed, 0, canon)).not.toBe(takeSeed(s, 0, canon));
  });
  it('every further roll lands somewhere else, deterministically', () => {
    const s = state();
    const seeds = [0, 1, 2, 3, 4].map((r) => takeSeed(s, r, canon));
    expect(new Set(seeds).size).toBe(seeds.length);
    expect([0, 1, 2, 3, 4].map((r) => takeSeed(s, r, canon))).toEqual(seeds);
  });
});

describe('rendering a pack', () => {
  it('refuses an unknown pack rather than drawing something arbitrary', async () => {
    expect(await renderProcPackAsync({ state: state(), packId: 'no-such-pack', maxPx: 64, seed: 1 })).toBeNull();
  });

  // jsdom gives no 2D context, so the draw path itself cannot run here; it returns null rather
  // than throwing, which is the contract the caller relies on to fall back.
  it('returns null rather than throwing where the platform has no 2D context', async () => {
    await expect(renderProcPackAsync({ state: state(), packId: PACKS.find((p) => !p.drawAsync)!.id, maxPx: 64, seed: 1 })).resolves.toBeNull();
  });
});
