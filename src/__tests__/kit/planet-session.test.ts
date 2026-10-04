import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { newMap } from '../../kit/operations/map';
import {
  enterPlanetSession, leavePlanetSession, finishPlanetSession, sessionTemplate,
} from '../../kit/operations/planet-session';
import { host } from '../../kit/host';
import { PLAZA_ID } from '../../core/model/constants';
import { deriveBoundary, isPlanetCanvasId, planetTemplateId, PLANET_MAX_CELLS } from '../../core/model/planet';
import { validatePlanetTemplate } from '../../core/model/planet-validate';
import { CellZone, CommandType, TerrainType, type GroundZone, type MacroCoord, type MapTemplate } from '../../core/model/types';
import type { PlanetEntry } from '../../io/planet-library';
import { planetFixture, NO_PLAZA } from '../fixtures/planet';
import { PLANET_PROFILE } from '../../core/model/game-profile';

const store = () => useEditorStore.getState();

function paintGround(cells: MacroCoord[], ground: GroundZone = CellZone.Grass): void {
  store().commandExecutor!.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: TerrainType.Mountain, elevation: 0, ground });
}

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

/** The fixture planet with its shore derived, so a crop of it reproduces it exactly. With `sand`,
 *  a two-cell sand ring lies around the grass, as on the built-in planets. */
function shoredPlanet(sand = false): MapTemplate {
  const { id: _id, name, ...rest } = planetFixture();
  const zones = rest.zones.map((row, y) => row.map((z, x) => {
    if (!sand || z !== CellZone.Void) return z;
    const grassNear = [-2, -1, 0, 1, 2].some((dy) => [-2, -1, 0, 1, 2].some((dx) => rest.zones[y + dy]?.[x + dx] === CellZone.Grass));
    return grassNear ? CellZone.Beach : z;
  }));
  const body = { ...rest, zones: deriveBoundary(zones) };
  return { id: planetTemplateId(body), name, ...body };
}

const cellAt = (x: number, y: number) => store().gridState!.cells[y]![x]!;

const entryOf = (template: MapTemplate): PlanetEntry => ({ entryId: 'e1', name: 'Bay', nameReviewed: true, template, createdAt: 0, updatedAt: 0 });

describe('planet session', () => {
  beforeEach(() => { localStorage.clear(); newMap('hexia'); });
  afterEach(() => { leavePlanetSession(); host.camera.takeQueued(); });

  it('leave restores the same executor and undo stack', () => {
    const s = store();
    s.commandExecutor!.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 80, y: 40 }], terrainType: TerrainType.Mountain, elevation: 1 });
    const executor = s.commandExecutor, grid = s.gridState, undo = executor!.getUndoStackSize();
    enterPlanetSession(null);
    expect(store().gridState).not.toBe(grid);
    expect(store().commandExecutor).not.toBe(executor);
    paintGround(rect(10, 10, 4, 4));
    leavePlanetSession();
    expect(store().commandExecutor).toBe(executor);
    expect(store().gridState).toBe(grid);
    expect(executor!.getUndoStackSize()).toBe(undo);
    expect(store().planetSession).toBeNull();
  });

  it('leave restores selection, layers, edit mode and view mode', () => {
    const s = store();
    s.setEditMode({ mode: 'water', tool: 'erase' });
    s.setActiveLayer(2);
    s.setLayerVisibility(1, false);
    s.setLayerLocked(3, true);
    s.setSelection([{ kind: 'terrain', x: 5, y: 6 }]);
    s.setViewMode('3d');
    const before = store();
    const saved = {
      editMode: before.editMode, activeLayer: before.activeLayer, layerPinned: before.layerPinned,
      layerVisibility: before.layerVisibility, layerLocked: before.layerLocked, selection: before.selection,
    };
    enterPlanetSession(null);
    expect(store().viewMode).toBe('2d');
    expect(store().selection).toEqual([]);
    leavePlanetSession();
    const after = store();
    expect(after.editMode).toBe(saved.editMode);
    expect(after.designMode).toBe(before.designMode);
    expect(after.activeLayer).toBe(saved.activeLayer);
    expect(after.layerPinned).toBe(saved.layerPinned);
    expect(after.layerVisibility).toBe(saved.layerVisibility);
    expect(after.layerLocked).toBe(saved.layerLocked);
    expect(after.selection).toBe(saved.selection);
    expect(after.viewMode).toBe('3d');
    s.setViewMode('2d');
  });

  it('parks the painted region with the map and clears it inside the session', () => {
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }];
    store().setRegion(region);
    store().setSelectingRegion(true);
    store().setDeletePopover({ kind: 'terrain', x: 1, y: 1 });
    enterPlanetSession(null);
    expect(store().region).toEqual([]);
    expect(store().selectingRegion).toBe(false);
    expect(store().deletePopover).toBeNull();
    leavePlanetSession();
    expect(store().region).toBe(region);
  });

  it('parks the cameras it is given and returns them on leave', () => {
    const camera = { x: 3, y: 4, zoom: 2 };
    enterPlanetSession(null, { view2d: camera });
    expect(store().planetSession!.parked.camera2d).toEqual(camera);
    expect(leavePlanetSession()).toEqual({ view2d: camera });
    expect(host.camera.takeQueued()).toBeNull();
  });

  it('returns no camera on leave when none was parked', () => {
    enterPlanetSession(null);
    expect(leavePlanetSession()).toBeNull();
  });

  it('gives each session its own canvas id, so an id-keyed template cache never serves an earlier canvas', () => {
    enterPlanetSession(null);
    const first = store().gridState!.template.id;
    leavePlanetSession();
    enterPlanetSession(entryOf(planetFixture()));
    const second = store().gridState!.template.id;
    expect(isPlanetCanvasId(first) && isPlanetCanvasId(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it('opens a new planet as a blank sea canvas in mountain mode under the planet rules', () => {
    enterPlanetSession(null);
    const s = store();
    expect(isPlanetCanvasId(s.gridState!.template.id)).toBe(true);
    expect(s.gridState!.template.width).toBe(PLANET_MAX_CELLS);
    expect(s.gridState!.template.height).toBe(PLANET_MAX_CELLS);
    expect(s.gridState!.cells.every((row) => row.every((c) => c.zone === CellZone.Void))).toBe(true);
    expect(s.gridState!.objects.size).toBe(0);
    expect(s.planetSession).toMatchObject({ entryId: null, name: '' });
    expect(s.planetMaterial).toBe('mountain');
    expect(s.editMode.mode).toBe('mountain');
    paintGround(rect(10, 10, 2, 2));
    expect(s.gridState!.cells[10]![10]!.zone).toBe(CellZone.Grass);
  });

  it.each([
    ['edge cut', { mode: 'mountain', tool: 'trim' }],
    ['smart build', { mode: 'mountain', tool: 'smart', macro: 'raise' }],
  ] as const)('enters with the brush armed after %s and restores it on leave', (_label, patch) => {
    store().setEditMode(patch);
    const parked = store().editMode;
    enterPlanetSession(null);
    expect(store().editMode).toMatchObject({ mode: 'mountain', tool: 'brush' });
    expect(store().designMode).toBe('brush');
    expect(store().armedMacro).toBeNull();
    leavePlanetSession();
    expect(store().editMode).toBe(parked);
  });

  it('puts the parked map back when entry fails after the canvas is installed', () => {
    const grid = store().gridState, executor = store().commandExecutor;
    const original = store().setPlanetMaterial;
    useEditorStore.setState({ setPlanetMaterial: () => { throw new Error('install'); } });
    try {
      expect(() => enterPlanetSession(null)).toThrow('install');
    } finally {
      useEditorStore.setState({ setPlanetMaterial: original });
    }
    expect(store().gridState).toBe(grid);
    expect(store().commandExecutor).toBe(executor);
    expect(store().planetSession).toBeNull();
    store().eventBus.emit('cells-changed', { cells: [{ x: 1, y: 1 }] });
    expect(store().gridState).toBe(grid);
  });

  it('opens a saved planet with its shore derived on the canvas and with a movable plaza', () => {
    enterPlanetSession(entryOf(shoredPlanet()));
    const s = store();
    expect(s.planetSession).toMatchObject({ entryId: 'e1', name: 'Bay' });
    const zones = s.gridState!.cells.map((row) => row.map((c) => c.zone));
    expect(zones).toEqual(deriveBoundary(zones));
    expect(zones.flat()).toContain(CellZone.Boundary);
    const plaza = s.gridState!.objects.get(PLAZA_ID)!;
    expect(plaza.locked).toBe(false);
    expect(plaza.position.x % 1).toBe(0.5);
  });

  it('keeps the shore rim live around ground edits, undo and redo, outside the history', () => {
    enterPlanetSession(null);
    const cells = () => store().gridState!.cells;
    const executor = store().commandExecutor!;
    paintGround(rect(10, 10, 2, 2));
    expect(executor.getUndoStackSize()).toBe(1);
    expect(cells()[9]![9]!.zone).toBe(CellZone.Boundary);
    expect(cells()[12]![12]!.zone).toBe(CellZone.Boundary);
    expect(cells()[8]![8]!.zone).toBe(CellZone.Void);
    executor.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: rect(10, 10, 2, 2), ground: CellZone.Void });
    expect(cells().flat().some((c) => c.zone === CellZone.Boundary)).toBe(false);
    executor.undo();
    expect(cells()[9]![9]!.zone).toBe(CellZone.Boundary);
    executor.redo();
    expect(cells()[9]![9]!.zone).toBe(CellZone.Void);
  });

  it('lays the rim over sand painted beside grass and gives the sand back when the grass goes', () => {
    enterPlanetSession(null);
    const executor = store().commandExecutor!;
    paintGround(rect(10, 10, 3, 3));
    paintGround([...rect(13, 10, 2, 3)], CellZone.Beach);
    expect(cellAt(13, 11)).toMatchObject({ zone: CellZone.Boundary, under: CellZone.Beach });
    expect(cellAt(14, 11).zone).toBe(CellZone.Beach);
    expect(cellAt(9, 11)).toEqual({ zone: CellZone.Boundary, terrain: null });
    executor.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: rect(12, 10, 1, 3), ground: CellZone.Void });
    expect(cellAt(12, 11)).toEqual({ zone: CellZone.Boundary, terrain: null });
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Beach, terrain: null });
    executor.undo();
    expect(cellAt(13, 11)).toMatchObject({ zone: CellZone.Boundary, under: CellZone.Beach });
    executor.undo();
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Boundary, terrain: null });
    expect(cellAt(14, 11).zone).toBe(CellZone.Void);
    executor.redo();
    expect(cellAt(13, 11)).toMatchObject({ zone: CellZone.Boundary, under: CellZone.Beach });
    executor.redo();
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Beach, terrain: null });
  });

  it('erases the sand under a rim to sea, which shows once the grass beside it goes', () => {
    enterPlanetSession(null);
    const executor = store().commandExecutor!;
    paintGround(rect(10, 10, 3, 3));
    paintGround([{ x: 13, y: 11 }], CellZone.Beach);
    executor.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x: 13, y: 11 }], ground: CellZone.Void });
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Boundary, terrain: null });
    executor.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: rect(12, 10, 1, 3), ground: CellZone.Void });
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Void, terrain: null });
  });

  it('keeps sand beside grass under a rim through finish, so the saved rim follows the rule', () => {
    enterPlanetSession(null);
    paintGround(rect(100, 100, 20, 20));
    paintGround(rect(120, 100, 3, 20), CellZone.Beach);
    const t = sessionTemplate(store().gridState!)!;
    const at = (x: number, y: number) => t.zones[y - 96]![x - 96]!;
    expect(at(120, 110)).toBe(CellZone.Boundary);
    expect(at(121, 110)).toBe(CellZone.Beach);
    expect(at(99, 110)).toBe(CellZone.Boundary);
    expect(at(98, 110)).toBe(CellZone.Void);
    expect(t.zones).toEqual(deriveBoundary(t.zones.map((row) => row.map((z) => (z === CellZone.Boundary ? CellZone.Void : z)))));
  });

  it('opens a saved planet with the sand under its rim and keeps it when the grass goes', () => {
    const planet = shoredPlanet(true);
    enterPlanetSession(entryOf(planet));
    const cells = store().gridState!.cells;
    const rimRows = cells.map((row) => row.filter((c) => c.zone === CellZone.Boundary));
    const last = rimRows.length - 1 - [...rimRows].reverse().findIndex((row) => row.length > 0);
    // The fixture's grass reaches one row short of its bottom edge, where no sand lies beyond the rim.
    expect(rimRows.slice(0, last).flat().every((c) => c.under === CellZone.Beach)).toBe(true);
    expect(sessionTemplate(store().gridState!)!.id).toBe(planet.id);
    const y = rimRows.findIndex((row) => row.length > 0);
    const x = cells[y]!.findIndex((c) => c.zone === CellZone.Boundary);
    store().commandExecutor!.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: rect(x, y + 1, 2, 1), ground: CellZone.Void });
    expect(cellAt(x, y)).toEqual({ zone: CellZone.Beach, terrain: null });
  });

  it('announces the rim cells it changed', () => {
    enterPlanetSession(null);
    const seen: MacroCoord[] = [];
    const listen = ({ cells }: { cells: MacroCoord[] }) => { seen.push(...cells); };
    store().eventBus.on('cells-changed', listen);
    paintGround([{ x: 20, y: 20 }]);
    store().eventBus.off('cells-changed', listen);
    expect(seen).toContainEqual({ x: 19, y: 19 });
    expect(seen).toContainEqual({ x: 21, y: 21 });
  });

  it('stops following the shore once the session ends', () => {
    enterPlanetSession(null);
    leavePlanetSession();
    const state = store().gridState!;
    const y = state.cells.findIndex((row) => row.some((c, x) => c.zone === CellZone.Grass && row[x + 1]?.zone === CellZone.Grass));
    const x = state.cells[y]!.findIndex((c, i, row) => c.zone === CellZone.Grass && row[i + 1]?.zone === CellZone.Grass);
    state.cells[y]![x]!.zone = CellZone.Void;
    store().eventBus.emit('cells-changed', { cells: [{ x, y }] });
    expect(state.cells[y]![x]!.zone).toBe(CellZone.Void);
    state.cells[y]![x]!.zone = CellZone.Grass;
  });

  it('a saved planet reopened and finished unchanged keeps its id', () => {
    const planet = shoredPlanet();
    expect(validatePlanetTemplate(planet)).toBeNull();
    enterPlanetSession(entryOf(planet));
    const t = sessionTemplate(store().gridState!)!;
    expect(t.id).toBe(planet.id);
    expect(t.plaza).toEqual(planet.plaza);
    expect(Array.from(t.terrain!)).toEqual(Array.from(planet.terrain!));
    expect(t.zones).toEqual(planet.zones);
  });

  it('records a pond on the drawn ground as water, with grass under it and no rim around it', () => {
    enterPlanetSession(null);
    paintGround(rect(100, 100, 40, 30));
    const plain = sessionTemplate(store().gridState!)!;
    store().commandExecutor!.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: rect(110, 110, 3, 2), terrainType: TerrainType.Water, elevation: 0 });
    expect(cellAt(111, 110)).toMatchObject({ zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 0 } });
    const t = sessionTemplate(store().gridState!)!;
    expect(t.zones).toEqual(plain.zones);
    expect(t.id).not.toBe(plain.id);
    expect(validatePlanetTemplate(t)).toBeNull();
    const at = (x: number, y: number) => (y - 96) * t.width + x - 96;
    expect(t.water?.[at(111, 110)]).toBe(1);
    expect(t.water?.reduce((n, v) => n + v, 0)).toBe(6);
    leavePlanetSession();
    enterPlanetSession(entryOf(t));
    expect(sessionTemplate(store().gridState!)!.id).toBe(t.id);
  });

  it('crops the drawn ground to whole chunks with a derived shore and no plaza', () => {
    enterPlanetSession(null);
    paintGround(rect(100, 100, 50, 40));
    const t = sessionTemplate(store().gridState!)!;
    expect(t.width).toBe(64);
    expect(t.height).toBe(48);
    expect(t.chunkGrid).toEqual({ origin: { x: 0, y: 0 }, columns: 4, rows: 3 });
    expect(t.id.startsWith('custom-')).toBe(true);
    expect(t.plaza).toEqual(NO_PLAZA);
    expect(t.zones.flat()).toContain(CellZone.Boundary);
    expect(validatePlanetTemplate(t)).toBeNull();
  });

  it('grows the crop to cover a plaza reaching past the ground', () => {
    enterPlanetSession(null);
    paintGround(rect(100, 100, 20, 20));
    const state = store().gridState!;
    state.objects.set(PLAZA_ID, { id: PLAZA_ID, catalogId: PLAZA_ID, position: { x: 130.5, y: 100.5 }, width: PLANET_PROFILE.landmark.width, height: PLANET_PROFILE.landmark.height, rotation: 0, elevation: 1, locked: false });
    const t = sessionTemplate(state)!;
    expect(t.width).toBe(64);
    expect(t.height).toBe(32);
    expect(t.chunkGrid).toEqual({ origin: { x: 0, y: 0 }, columns: 4, rows: 2 });
    expect(t.plaza).toMatchObject({ x: 34.5, y: 4.5, width: PLANET_PROFILE.landmark.width, height: PLANET_PROFILE.landmark.height });
    expect(t.plaza.x + t.plaza.width).toBeLessThanOrEqual(t.width);
    expect(t.plaza.y + t.plaza.height).toBeLessThanOrEqual(t.height);
  });

  it('finish names the planet and stays in the session', () => {
    enterPlanetSession(null);
    paintGround(rect(100, 100, 50, 40));
    const r = finishPlanetSession('Bay');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.template.name).toEqual({ en: 'Bay' });
    expect(store().planetSession).not.toBeNull();
  });

  it('finish refuses a planet with no ground', () => {
    enterPlanetSession(null);
    expect(finishPlanetSession('Bay')).toEqual({ ok: false, reason: 'empty' });
  });

  it('finish outside a session is empty', () => {
    expect(finishPlanetSession('Bay')).toEqual({ ok: false, reason: 'empty' });
  });
});
