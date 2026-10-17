// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapRevisionOf } from '../../../../state/map-revision';
import { paintPlanet, planetBounds, planetPictureSide, type CellExtent } from '../../../../view/map2d/capture/planet-painter';
import { mapCaptureFrame } from '../../../../core/grid/map-chunks';
import { mapPictureFrame } from '../../../../view/map2d/capture/thumbnail';
import { TERRAIN_GRID_OFFSET } from '../../../../core/grid/grid-convert';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../../../../view/shared/grid/reference-grid';
import { numberToHexString } from '../../../../core/base/color';
import { getMapTemplate } from '../../../../config/maps';
import { createGridState } from '../../../../core/model/template';
import { TerrainType, type GridState, type MapTemplate } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { LOSS_COLOR } from '../../../../view/shared/viewport/view-constants';

interface Call { op: string; args: unknown[]; fillStyle: unknown; alpha: number; target: HTMLCanvasElement }

/** Every canvas answers with a recording context; `calls` is shared so the offscreen rasters show. */
function recordCanvases(): Call[] {
  const calls: Call[] = [];
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const target = this;
    const known = contexts.get(target);
    if (known) return known;
    let fillStyle: unknown = '#000', alpha = 1;
    const rec = (op: string) => (...args: unknown[]) => { calls.push({ op, args, fillStyle, alpha, target }); };
    const ctx = {
      get fillStyle() { return fillStyle; }, set fillStyle(v: unknown) { fillStyle = v; },
      get globalAlpha() { return alpha; }, set globalAlpha(v: number) { alpha = v; },
      imageSmoothingEnabled: true,
      setTransform: rec('setTransform'), clearRect: rec('clearRect'), fillRect: rec('fillRect'),
      drawImage: rec('drawImage'), save: rec('save'), restore: rec('restore'),
      translate: rec('translate'), rotate: rec('rotate'),
    } as unknown as CanvasRenderingContext2D;
    contexts.set(target, ctx);
    return ctx;
  } as unknown as HTMLCanvasElement['getContext']);
  return calls;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: w });
  Object.defineProperty(canvas, 'clientHeight', { value: h });
  return canvas;
}

/** The rest view's placement of `bounds` in a `w` by `h` box, read off the transform the painter
 *  draws under at device ratio 1: css px per cell and the css position of cell (0, 0). */
function restFit(template: MapTemplate, w: number, h: number, margin: number, bounds?: CellExtent): { cell: number; x: number; y: number } {
  const calls = recordCanvases();
  vi.stubGlobal('devicePixelRatio', 1);
  const canvas = canvasOf(w, h);
  paintPlanet(canvas, { template }, null, { tx: 0, ty: 0, scale: 1 }, { margin, ...(bounds ? { bounds } : {}) });
  const [cell, , , , x, y] = calls.filter((c) => c.op === 'setTransform' && c.target === canvas).pop()!.args as number[];
  vi.restoreAllMocks();
  return { cell: cell!, x: x!, y: y! };
}

function emptyPlanet(): MapTemplate {
  const zones = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => CellZone.Void));
  return { id: 'custom-empty', name: { en: 'empty' }, width: 32, height: 32, zones, landmarks: [] };
}

/** Sea with one rectangle of grass. */
function islet(width: number, height: number, g: { x: number; y: number; w: number; h: number }): MapTemplate {
  const zones = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    (x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h ? CellZone.Grass : CellZone.Void)));
  return { id: 'custom-islet', name: { en: 'islet' }, width, height, zones, landmarks: [] };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('paintPlanet', () => {
  it('places the map picture over the frame the capture took: the template, its terrain bleed and what it draws past them', () => {
    const calls = recordCanvases();
    const canvas = canvasOf(300, 200);
    const template = getMapTemplate('hexia');
    const picture = document.createElement('canvas');
    paintPlanet(canvas, { template }, picture, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    const frame = mapPictureFrame(createGridState(template));
    // Hexia's station is laid past the template's last row; the reference grid's sea is not drawn.
    expect(frame.y + frame.height).toBeGreaterThan(template.height);
    expect([frame.x, frame.y, frame.x + frame.width]).toEqual([-0.5, -0.5, template.width]);
    expect(mapCaptureFrame(template)).not.toEqual(frame);
    const drawn = calls.find((c) => c.op === 'drawImage' && c.target === canvas && c.args[0] === picture);
    expect(drawn?.args.slice(1)).toEqual([frame.x, frame.y, frame.width, frame.height]);
  });

  it('paints an empty planet, and a planet whose picture has not arrived, without throwing', () => {
    const calls = recordCanvases();
    const canvas = canvasOf(120, 120);
    expect(() => paintPlanet(canvas, { template: emptyPlanet() }, null, { tx: 0, ty: 0, scale: 1 }, { margin: 0 })).not.toThrow();
    expect(calls.some((c) => c.op === 'drawImage' && c.target === canvas)).toBe(false);
  });

  it('sizes the backing store to the device-pixel ratio', () => {
    recordCanvases();
    vi.stubGlobal('devicePixelRatio', 2);
    const canvas = canvasOf(300, 200);
    paintPlanet(canvas, { template: emptyPlanet() }, null, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    expect([canvas.width, canvas.height]).toEqual([600, 400]);
  });

  it('fits the land, not the grid, with equal margins and centred, then zooms about the centre and pans', () => {
    const calls = recordCanvases();
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = canvasOf(200, 140);
    const template = islet(32, 32, { x: 4, y: 8, w: 8, h: 4 });
    const transformOf = (view: { tx: number; ty: number; scale: number }) => {
      calls.length = 0;
      paintPlanet(canvas, { template }, null, view, { margin: 20 });
      const set = calls.filter((c) => c.op === 'setTransform' && c.target === canvas);
      return set[set.length - 1]!.args as number[];
    };
    // 160 x 100 css px inside the margin hold the 8 x 4 islet at 20 px a cell: 160 x 80, centred.
    const [a, , , , ox, oy] = transformOf({ tx: 0, ty: 0, scale: 1 });
    expect(a).toBe(20);
    const left = ox! + 4 * a!, top = oy! + 8 * a!;
    const right = 200 - (left + 8 * a!), bottom = 140 - (top + 4 * a!);
    expect([left, right]).toEqual([20, 20]);
    expect([top, bottom]).toEqual([30, 30]);
    // Twice the zoom about the canvas centre (100, 70), then 10 px right.
    expect(transformOf({ tx: 10, ty: 0, scale: 2 })).toEqual([40, 0, 0, 40, 100 + (ox! - 100) * 2 + 10, 70 + (oy! - 70) * 2]);
  });

  it('keeps dropped cells beyond the land in the rest view', () => {
    const calls = recordCanvases();
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = canvasOf(200, 200);
    const template = islet(32, 32, { x: 10, y: 10, w: 10, h: 10 });
    paintPlanet(canvas, { template, dropped: [{ x: 0, y: 10, grid: 'object' }] }, null, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    const [a, , , , ox] = calls.filter((c) => c.op === 'setTransform' && c.target === canvas).pop()!.args as number[];
    // Columns 0 to 20 across 200 px: 10 px a cell, cell 0 at the left edge.
    expect([a, ox]).toEqual([10, 0]);
  });

  it('draws the chunk dashes faintly across the whole template without moving the fit to the land', () => {
    const calls = recordCanvases();
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = canvasOf(300, 200);
    const template = { ...islet(64, 64, { x: 20, y: 24, w: 10, h: 6 }), chunkGrid: { origin: { x: 0, y: 0 }, columns: 4, rows: 4 } };
    paintPlanet(canvas, { template }, null, { tx: 0, ty: 0, scale: 1 }, { margin: 12 });
    const [a, , , , ox, oy] = calls.filter((c) => c.op === 'setTransform' && c.target === canvas).pop()!.args as number[];
    const fit = { cell: a!, x: ox!, y: oy! };
    // Fitted to the land: the tighter axis keeps the 12 px margin and the other centres it.
    const land = planetBounds({ template });
    const margins = [fit.x + land.x0 * fit.cell, 300 - (fit.x + land.x1 * fit.cell), fit.y + land.y0 * fit.cell, 200 - (fit.y + land.y1 * fit.cell)];
    expect(Math.min(...margins)).toBeCloseTo(12, 6);
    expect(margins[0]).toBeCloseTo(margins[1]!, 6);
    expect(margins[2]).toBeCloseTo(margins[3]!, 6);
    const dashes = calls.filter((c) => c.target === canvas && c.op === 'fillRect');
    const expected = chunkGridRects(template, chunkStrokeCells(fit.cell, CHUNK_GRID_STYLE.planetPreview.widthPx));
    expect(dashes.map((c) => c.args)).toEqual(expected.map((r) => [r.x, r.y, r.width, r.height]));
    expect(dashes.every((c) => c.alpha === CHUNK_GRID_STYLE.planetPreview.opacity)).toBe(true);
    expect(dashes.every((c) => c.fillStyle === numberToHexString(CHUNK_GRID_STYLE.planetPreview.ink))).toBe(true);
    expect(CHUNK_GRID_STYLE.planetPreview.opacity).toBeLessThan(CHUNK_GRID_STYLE.planetFrame.opacity);
    // The dashes reach the template's far edges, well past the land the picture is fitted to.
    expect(Math.max(...expected.map((r) => r.x + r.width))).toBeGreaterThan(60);
  });

  it('fits the given bounds with the margin on the tighter axis and equal margins on opposite sides', () => {
    const fit = restFit(islet(16, 16, { x: 0, y: 0, w: 16, h: 16 }), 300, 100, 10, { x0: 2, y0: 3, x1: 12, y1: 8 });
    // 280 x 80 of room for 10 x 5 cells: 16 px a cell, so 160 x 80.
    expect(fit.cell).toBe(16);
    const left = fit.x + 2 * fit.cell, top = fit.y + 3 * fit.cell;
    expect(left).toBe(300 - (left + 160));
    expect(top).toBe(10);
    expect(100 - (top + 80)).toBe(10);
  });

  it('draws the dropped cells in red, off-planet included, each where its own grid lays it', () => {
    const calls = recordCanvases();
    const state = createGridState(getMapTemplate('hexia'));
    const canvas = canvasOf(300, 200);
    // A placement cell covers [x, x + 1); a terrain cell of the same index [x - 0.5, x + 0.5).
    const dropped = [{ x: -3, y: 5, grid: 'object' as const }, { x: 7, y: 9, grid: 'terrain' as const }];
    paintPlanet(canvas, { state, template: state.template, dropped }, null, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    const drawn = calls.filter((c) => c.target === canvas && c.op === 'drawImage');
    expect(drawn.some((c) => c.args[1] === -3 && c.args[2] === 5 && c.args[3] === 10.5 && c.args[4] === 4.5)).toBe(true);
    const fills = calls.filter((c) => c.target !== canvas && c.op === 'fillRect' && c.fillStyle === LOSS_COLOR).map((c) => c.args);
    // Two raster pixels a cell, from the raster's origin at (-3, 5).
    expect(fills).toEqual([[0, 0, 2, 2], [19, 7, 2, 2]]);
  });

  it('fits the land as it stands at each revision, raised terrain at the terrain grid\'s offset', () => {
    const template = islet(32, 32, { x: 10, y: 10, w: 4, h: 4 });
    const state = createGridState(template);
    const at = () => planetBounds({ state, revision: mapRevisionOf(state), template });
    expect(at()).toEqual({ x0: 10, y0: 10, x1: 14, y1: 14 });
    state.cells[20]![20]!.terrain = { type: TerrainType.Mountain, elevation: 3 };
    expect(at(), 'the same revision keeps its land').toEqual({ x0: 10, y0: 10, x1: 14, y1: 14 });
    state.cellsVersion = (state.cellsVersion ?? 0) + 1;
    const { x: ox, y: oy } = TERRAIN_GRID_OFFSET;
    expect(at()).toEqual({ x0: 10, y0: 10, x1: 21 + ox, y1: 21 + oy });
  });

  it('asks for a sharper picture in steps as the zoom grows', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const template = islet(32, 32, { x: 0, y: 0, w: 32, h: 32 });
    const canvas = canvasOf(160, 160);
    const side = (scale: number) => planetPictureSide(canvas, { template }, { tx: 0, ty: 0, scale }, { margin: 0 });
    // 5 px a cell across the frame's 32.5 cells is 162.5 px: the 256 step.
    expect(side(1)).toBe(256);
    expect(side(3)).toBe(512);
    expect(side(100)).toBe(4096);
  });
});

describe('planetPicture', () => {
  it('is the renderer\'s picture of the map at its revision, or of the fresh map a template opens as', async () => {
    const asked: { state: GridState; side: number; opts: unknown }[] = [];
    vi.resetModules();
    vi.doMock('../../../../view/map2d/capture/thumbnail', () => ({
      mapPicture: async (state: GridState, side: number, opts: unknown) => { asked.push({ state, side, opts }); return null; },
    }));
    const painter = await import('../../../../view/map2d/capture/planet-painter');
    const template = getMapTemplate('hexia');
    const state = createGridState(template);
    await painter.planetPicture({ template, state, revision: '3:4' }, 1024);
    await painter.planetPicture({ template }, 512);
    await painter.planetPicture({ template }, 512);
    expect(asked[0]).toEqual({ state, side: 1024, opts: { version: '3:4' } });
    expect(asked[1]!.state.template).toBe(template);
    expect(asked[2]!.state, 'one fresh map per template').toBe(asked[1]!.state);
    vi.doUnmock('../../../../view/map2d/capture/thumbnail');
  });
});
