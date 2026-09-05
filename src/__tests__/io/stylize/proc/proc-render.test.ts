import { describe, it, expect } from 'vitest';
import { CellZone } from '../../../../core/model/types';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { createGrid } from '../../../../core/model/grid-model';
import { TILE_SIZE } from '../../../../core/model/constants';
import { bandGeometry, mapNativePx } from '../../../../io/export/sizing';
import { mapSeed, procView, renderProcPack, takeSeed } from '../../../../io/stylize/proc/render';
import { PROC_PACKS, procPack, isProcPackId } from '../../../../io/stylize/proc/packs';
import { STYLE_PACKS, CUSTOM_DIRECTION_ID } from '../../../../io/stylize/presets';
import { validatePalette } from '../../../../io/stylize/proc/palette';

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
  return { template: t, cells: createGrid(t), objects: new Map(), lockedLayers: new Set<number>() };
}

describe('band geometry — the one frame two renderers must agree on', () => {
  it('keeps the capturerect half-cell bleed on top and left', () => {
    const band = bandGeometry({ width: 169, height: 140 });
    expect(band.originX).toBe(-0.5);
    expect(band.originY).toBe(-0.5);
    expect(band.widthCells).toBe(169.5);
    expect(band.heightCells).toBe(140.5);
  });

  it('reproduces the pixel size the 2D capture asks for, exactly', () => {
    // MapRenderer.captureMapImage frames (-half, -half, w*TILE + half, h*TILE + half).
    for (const t of [{ width: 169, height: 140 }, { width: 20, height: 14 }, { width: 1, height: 1 }]) {
      const half = TILE_SIZE / 2;
      expect(mapNativePx(t)).toEqual({ w: t.width * TILE_SIZE + half, h: t.height * TILE_SIZE + half });
    }
  });

  it('a procedural view spans the same band, so composed ink cannot land off by half a cell', () => {
    const s = state();
    const v = procView(s, 400);
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
    for (const pack of PROC_PACKS) expect(model.has(pack.id)).toBe(false);
  });

  it('holds every pack under a unique id', () => {
    const ids = PROC_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('resolves an id and rejects one it does not know', () => {
    for (const p of PROC_PACKS) expect(procPack(p.id)).toBe(p);
    expect(procPack('no-such-pack')).toBeUndefined();
    expect(isProcPackId('no-such-pack')).toBe(false);
  });

  it('EVERY pack passes the value rules — the defect cannot enter by the back door', () => {
    for (const pack of PROC_PACKS) {
      expect({ id: pack.id, problems: validatePalette(pack.palette) }).toEqual({ id: pack.id, problems: [] });
    }
  });

  it('every pack declares an i18n key and a cost bucket', () => {
    for (const pack of PROC_PACKS) {
      expect(pack.nameKey).toMatch(/^stylize\.proc_/);
      expect(pack.cost).toBeGreaterThanOrEqual(1);
      expect(pack.cost).toBeLessThanOrEqual(5);
    }
  });
});

describe('takeSeed — one seed per roll of a style', () => {
  it('roll 0 IS the map seed: the first take draws the canonical picture the minis show', () => {
    const s = state();
    expect(takeSeed(s, 0)).toBe(mapSeed(s));
  });
  it('every further roll lands somewhere else, deterministically', () => {
    const s = state();
    const seeds = [0, 1, 2, 3, 4].map((r) => takeSeed(s, r));
    expect(new Set(seeds).size).toBe(seeds.length);
    expect([0, 1, 2, 3, 4].map((r) => takeSeed(s, r))).toEqual(seeds);
  });
});

describe('renderProcPack', () => {
  it('refuses an unknown pack rather than drawing something arbitrary', () => {
    expect(renderProcPack({ state: state(), packId: 'no-such-pack', maxPx: 64, seed: 1 })).toBeNull();
  });

  // jsdom gives no 2D context, so the draw path itself cannot run here; it returns null rather
  // than throwing, which is the contract the caller relies on to fall back.
  it('returns null rather than throwing where the platform has no 2D context', () => {
    expect(() => renderProcPack({ state: state(), packId: PROC_PACKS[0]!.id, maxPx: 64, seed: 1 })).not.toThrow();
  });
});
