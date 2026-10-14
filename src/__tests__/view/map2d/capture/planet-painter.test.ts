// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapRevisionOf } from '../../../../state/map-revision';
import { paintPlanet, planetBounds, type CellExtent } from '../../../../view/map2d/capture/planet-painter';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../../../../view/shared/grid/reference-grid';
import { numberToHexString } from '../../../../core/base/color';
import { getMapTemplate } from '../../../../config/maps';
import { createGridState } from '../../../../core/model/template';
import { TerrainType, type MapTemplate } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { LOSS_COLOR } from '../../../../view/shared/viewport/view-constants';
import { ELEVATION_COLORS } from '../../../../core/model/palette';
import { landmarkAt } from '../../../_support/planet';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { templateAnchor } from '../../../../core/model/landmarks';

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
  paintPlanet(canvas, { template }, { tx: 0, ty: 0, scale: 1 }, { margin, ...(bounds ? { bounds } : {}) });
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
  it('draws the planet raster into the canvas', () => {
    const calls = recordCanvases();
    const canvas = canvasOf(300, 200);
    paintPlanet(canvas, { template: getMapTemplate('hexia') }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    expect(calls.some((c) => c.op === 'drawImage' && c.target === canvas)).toBe(true);
  });

  it('paints an empty planet without throwing', () => {
    const calls = recordCanvases();
    const canvas = canvasOf(120, 120);
    expect(() => paintPlanet(canvas, { template: emptyPlanet() }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 })).not.toThrow();
    expect(calls.some((c) => c.op === 'drawImage' && c.target === canvas)).toBe(true);
  });

  it('sizes the backing store to the device-pixel ratio and turns smoothing off', () => {
    recordCanvases();
    vi.stubGlobal('devicePixelRatio', 2);
    const canvas = canvasOf(300, 200);
    paintPlanet(canvas, { template: emptyPlanet() }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    expect([canvas.width, canvas.height]).toEqual([600, 400]);
    expect((canvas.getContext('2d') as CanvasRenderingContext2D).imageSmoothingEnabled).toBe(false);
  });

  it('fits the land, not the grid, with equal margins and centred, then zooms about the centre and pans', () => {
    const calls = recordCanvases();
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = canvasOf(200, 140);
    const template = islet(32, 32, { x: 4, y: 8, w: 8, h: 4 });
    const transformOf = (view: { tx: number; ty: number; scale: number }) => {
      calls.length = 0;
      paintPlanet(canvas, { template }, view, { margin: 20 });
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
    paintPlanet(canvas, { template, dropped: [{ x: 0, y: 10 }] }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    const [a, , , , ox] = calls.filter((c) => c.op === 'setTransform' && c.target === canvas).pop()!.args as number[];
    // Columns 0 to 20 across 200 px: 10 px a cell, cell 0 at the left edge.
    expect([a, ox]).toEqual([10, 0]);
  });

  it('draws the chunk dashes faintly across the whole template without moving the fit to the land', () => {
    const calls = recordCanvases();
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = canvasOf(300, 200);
    const template = { ...islet(64, 64, { x: 20, y: 24, w: 10, h: 6 }), chunkGrid: { origin: { x: 0, y: 0 }, columns: 4, rows: 4 } };
    paintPlanet(canvas, { template }, { tx: 0, ty: 0, scale: 1 }, { margin: 12 });
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

  it('repaints once the plaza icon arrives, and forgets waiting paints when it fails', async () => {
    const images: HTMLImageElement[] = [];
    const RealImage = globalThis.Image;
    vi.stubGlobal('Image', class extends RealImage { constructor() { super(); images.push(this); } });
    vi.resetModules();
    const painter = await import('../../../../view/map2d/capture/planet-painter');
    const calls = recordCanvases();
    // The plaza alone, so one icon loads.
    const hexia = { ...getMapTemplate('hexia'), landmarks: [templateAnchor(getMapTemplate('hexia'))!] };
    const first = canvasOf(300, 200);
    painter.paintPlanet(first, { template: hexia }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    expect(images).toHaveLength(1);

    // Loaded: the waiting canvas paints again.
    Object.defineProperty(images[0]!, 'complete', { value: true, configurable: true });
    Object.defineProperty(images[0]!, 'naturalWidth', { value: 40, configurable: true });
    Object.defineProperty(images[0]!, 'naturalHeight', { value: 54, configurable: true });
    const before = calls.filter((c) => c.target === first && c.op === 'drawImage').length;
    images[0]!.onload!(new Event('load'));
    const after = calls.filter((c) => c.target === first && c.op === 'drawImage');
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((c) => c.args[0] === images[0])).toBe(true);
    // The repaint was owed once: another load event finds nothing waiting.
    images[0]!.onload!(new Event('load'));
    expect(calls.filter((c) => c.target === first && c.op === 'drawImage')).toHaveLength(after.length);

    // A failed load in a fresh module leaves nothing waiting and stops asking.
    images.length = 0;
    vi.resetModules();
    const failing = await import('../../../../view/map2d/capture/planet-painter');
    const waiting = canvasOf(300, 200);
    failing.paintPlanet(waiting, { template: hexia }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    const painted = calls.filter((c) => c.target === waiting).length;
    images[0]!.onerror!(new Event('error'));
    failing.paintPlanet(canvasOf(300, 200), { template: hexia }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    // A late load of the failed icon repaints nothing, and no paint asks for the icon again.
    Object.defineProperty(images[0]!, 'complete', { value: true, configurable: true });
    Object.defineProperty(images[0]!, 'naturalWidth', { value: 40, configurable: true });
    images[0]!.onload?.(new Event('load'));
    expect(calls.filter((c) => c.target === waiting)).toHaveLength(painted);
    expect(images).toHaveLength(1);
  });

  it('draws a turned plaza upright, contained in its laid footprint', async () => {
    const images: HTMLImageElement[] = [];
    const RealImage = globalThis.Image;
    vi.stubGlobal('Image', class extends RealImage { constructor() { super(); images.push(this); } });
    vi.resetModules();
    const painter = await import('../../../../view/map2d/capture/planet-painter');
    const calls = recordCanvases();
    const zones = Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => CellZone.Grass));
    const template: MapTemplate = { id: 'custom-turned', name: { en: 't' }, width: 40, height: 40, zones, landmarks: [landmarkAt(4, 6, 90)]};
    const canvas = canvasOf(300, 200);
    painter.paintPlanet(canvas, { template }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
    Object.defineProperty(images[0]!, 'complete', { value: true, configurable: true });
    Object.defineProperty(images[0]!, 'naturalWidth', { value: 40, configurable: true });
    Object.defineProperty(images[0]!, 'naturalHeight', { value: 54, configurable: true });
    images[0]!.onload!(new Event('load'));
    const icon = calls.filter((c) => c.target === canvas && c.op === 'drawImage' && c.args[0] === images[0]);
    expect(icon.length).toBeGreaterThan(0);
    const [, x, y, w, h] = icon[icon.length - 1]!.args as number[];
    expect(calls.some((c) => c.target === canvas && c.op === 'rotate')).toBe(false);
    const { width: across, height: along } = ANCHOR_LANDMARK;
    expect(h).toBeCloseTo(across);
    expect(w).toBeCloseTo(across * 40 / 54);
    expect(x! >= 4 && x! + w! <= 4 + along && y! >= 6 && y! + h! <= 6 + across + 1e-9).toBe(true);
  });

  it('draws the terrain and objects the map holds, and the dropped cells in red', () => {
    const calls = recordCanvases();
    const state = createGridState(getMapTemplate('hexia'));
    state.cells[10]![20]!.terrain = { type: TerrainType.Mountain, elevation: 3 };
    state.objects.set('t', { id: 't', catalogId: 'tree-apple', position: { x: 30, y: 30 }, rotation: 0, elevation: 0 });
    const canvas = canvasOf(300, 200);
    const dropped = [{ x: -3, y: 5 }, { x: 7, y: 9 }];
    paintPlanet(canvas, { state, template: state.template, dropped }, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });

    const offscreen = calls.filter((c) => c.target !== canvas && c.op === 'fillRect');
    expect(offscreen.some((c) => c.fillStyle === ELEVATION_COLORS[3])).toBe(true);
    expect(offscreen.some((c) => (c.args as number[])[0] === 61 && (c.args as number[])[1] === 61)).toBe(true);
    // The dropped raster spans the cells, off-planet included, and lands at their origin.
    const drawn = calls.filter((c) => c.target === canvas && c.op === 'drawImage');
    expect(drawn.some((c) => c.args[1] === -3 && c.args[2] === 5 && c.args[3] === 11 && c.args[4] === 5)).toBe(true);
    expect(offscreen.some((c) => c.fillStyle === LOSS_COLOR)).toBe(true);
  });

  it('rasterises a map once per revision, and again when it is edited in place', () => {
    const calls = recordCanvases();
    const state = createGridState(getMapTemplate('hexia'));
    const canvas = canvasOf(300, 200);
    const mountains = () => calls.filter((c) => c.target !== canvas && c.op === 'fillRect' && c.fillStyle === ELEVATION_COLORS[3]).length;
    const view = { tx: 0, ty: 0, scale: 1 };
    paintPlanet(canvas, { state, revision: mapRevisionOf(state), template: state.template }, view, { margin: 0 });
    const rasterCalls = calls.filter((c) => c.target !== canvas).length;
    paintPlanet(canvas, { state, revision: mapRevisionOf(state), template: state.template }, { ...view, scale: 2 }, { margin: 0 });
    expect(calls.filter((c) => c.target !== canvas).length).toBe(rasterCalls);
    expect(mountains()).toBe(0);

    state.cells[10]![20]!.terrain = { type: TerrainType.Mountain, elevation: 3 };
    state.cellsVersion = (state.cellsVersion ?? 0) + 1;
    paintPlanet(canvas, { state, revision: mapRevisionOf(state), template: state.template }, view, { margin: 0 });
    expect(mountains()).toBe(1);
  });
});
