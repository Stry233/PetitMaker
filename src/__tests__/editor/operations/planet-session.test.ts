import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import type { EditContext } from '../../../core/commands/edit-context';
import {
  enterPlanetSession, leavePlanetSession, finishPlanetSession, sessionPlanet,
} from '../../../editor/operations/planet-session';
import { host } from '../../../editor/host/host';
import { planetTemplateId, PLANET_MAX_CELLS } from '../../../core/model/planet';
import { deriveBoundary } from '../../../core/model/shore';
import { isPlanetCanvasId } from '../../../tools/generation/run/planet-canvas';
import { validatePlanetTemplate } from '../../../core/model/planet-validate';
import { CommandType, TerrainType, type MacroCoord, type MapTemplate } from '../../../core/model/types';
import { CellZone, type GroundZone } from '../../../core/game/zones';
import type { PlanetEntry } from '../../../io/storage/planet-library';
import { planetFixture } from '../../_support/planet';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { templateAnchor } from '../../../core/model/landmarks';
import { EventBus } from '../../../core/commands/event-bus';
import { createGridState } from '../../../core/model/template';
import { createExecutor } from '../../../state/executor';
import type { EditorEvents } from '../../../state/editing/events';
import type { ParkedEditor, PlanetSession } from '../../../state/slices/planet-session';
import type { SessionPort } from '../../../editor/session/context';
import { cellSet, type CellSet } from '../../../core/grid/grids';
import { cellsOn } from '../../../core/grid/grid-convert';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { armedMacroOf, designModeOf } from '../../../state/editing/edit-mode';

/** A second editor beside the store's, with its own bus and canvas. */
function sideEditor(): SessionPort {
  const bus = new EventBus<EditorEvents>();
  let session: PlanetSession | null = null;
  let kit: EditContext | null = null;
  return {
    live: () => kit,
    events: () => bus,
    planetSession: () => session,
    park: () => ({}) as ParkedEditor,
    openPlanetCanvas: (template, registry, next) => {
      const state = createGridState(template);
      kit = { state, executor: createExecutor(state, registry, bus), registry };
      session = next;
    },
    endSession: () => { session = null; kit = null; },
  };
}

const store = () => useEditorStore.getState();

function paintGround(cells: MacroCoord[], ground: GroundZone = CellZone.Grass): void {
  store().commandExecutor!.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground });
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
  beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); });
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  it('leave restores the same executor and undo stack', () => {
    const s = store();
    s.commandExecutor!.execute({ type: CommandType.PaintTerrain, cells: [{ x: 80, y: 40 }], terrainType: TerrainType.Mountain, elevation: 1 });
    const executor = s.commandExecutor, grid = s.gridState, undo = executor!.historyDepth();
    enterPlanetSession(editorPort, null);
    expect(store().gridState).not.toBe(grid);
    expect(store().commandExecutor).not.toBe(executor);
    paintGround(rect(10, 10, 4, 4));
    leavePlanetSession(editorPort);
    expect(store().commandExecutor).toBe(executor);
    expect(store().gridState).toBe(grid);
    expect(executor!.historyDepth()).toBe(undo);
    expect(store().planetSession).toBeNull();
  });

  it('leave restores selection, layers, edit mode and view mode', () => {
    const s = store();
    s.setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    s.setActiveLayer(2);
    s.setLayerVisibility(1, false);
    s.setLayerLocked(3, true);
    s.setSelection([{ kind: 'terrain', x: 5, y: 6 }]);
    s.setViewMode('3d');
    const before = store();
    const saved = {
      editMode: before.editMode, activeLayer: before.activeLayer, layerPinned: before.layerPinned,
      layerVisibility: before.layerVisibility, lockedLayers: before.gridState!.lockedLayers, selection: before.selection,
    };
    enterPlanetSession(editorPort, null);
    expect(store().viewMode).toBe('2d');
    expect(store().selection).toEqual([]);
    leavePlanetSession(editorPort);
    const after = store();
    expect(after.editMode).toBe(saved.editMode);
    expect(designModeOf(after)).toBe(designModeOf(before));
    expect(after.activeLayer).toBe(saved.activeLayer);
    expect(after.layerPinned).toBe(saved.layerPinned);
    expect(after.layerVisibility).toBe(saved.layerVisibility);
    expect(after.gridState!.lockedLayers).toBe(saved.lockedLayers);
    expect(after.selection).toBe(saved.selection);
    expect(after.viewMode).toBe('3d');
    s.setViewMode('2d');
  });

  it('parks the painted region with the map and clears it inside the session', () => {
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }];
    store().setRegion(region);
    store().setSelectingRegion(true);
    store().setDeletePopover({ kind: 'terrain', x: 1, y: 1 });
    enterPlanetSession(editorPort, null);
    expect(store().region).toEqual([]);
    expect(store().selectingRegion).toBe(false);
    expect(store().deletePopover).toBeNull();
    leavePlanetSession(editorPort);
    expect(store().region).toBe(region);
  });

  it('parks the cameras it is given and returns them on leave', () => {
    const camera = { x: 3, y: 4, zoom: 2 };
    enterPlanetSession(editorPort, null, { view2d: camera });
    expect(store().planetSession!.parked.camera2d).toEqual(camera);
    expect(leavePlanetSession(editorPort)).toEqual({ view2d: camera });
    expect(host.camera.takeQueued()).toBeNull();
  });

  it('returns no camera on leave when none was parked', () => {
    enterPlanetSession(editorPort, null);
    expect(leavePlanetSession(editorPort)).toBeNull();
  });

  it('gives each session its own canvas id, so an id-keyed template cache never serves an earlier canvas', () => {
    enterPlanetSession(editorPort, null);
    const first = store().gridState!.template.id;
    leavePlanetSession(editorPort);
    enterPlanetSession(editorPort, entryOf(planetFixture()));
    const second = store().gridState!.template.id;
    expect(isPlanetCanvasId(first) && isPlanetCanvasId(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it('opens a new planet as a blank sea canvas in mountain mode under the planet rules', () => {
    enterPlanetSession(editorPort, null);
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
    enterPlanetSession(editorPort, null);
    expect(store().editMode).toMatchObject({ mode: 'mountain', arming: { kind: 'brush' } });
    expect(designModeOf(store())).toBe('free');
    expect(armedMacroOf(store())).toBeNull();
    leavePlanetSession(editorPort);
    expect(store().editMode).toBe(parked);
  });

  it('puts the parked map back when entry fails after the canvas is installed', () => {
    const grid = store().gridState, executor = store().commandExecutor;
    const original = store().setPlanetMaterial;
    useEditorStore.setState({ setPlanetMaterial: () => { throw new Error('install'); } });
    try {
      expect(() => enterPlanetSession(editorPort, null)).toThrow('install');
    } finally {
      useEditorStore.setState({ setPlanetMaterial: original });
    }
    expect(store().gridState).toBe(grid);
    expect(store().commandExecutor).toBe(executor);
    expect(store().planetSession).toBeNull();
    store().eventBus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, [{ x: 1, y: 1 }])] });
    expect(store().gridState).toBe(grid);
  });

  it('opens a saved planet with its shore derived on the canvas and with a movable plaza', () => {
    enterPlanetSession(editorPort, entryOf(shoredPlanet()));
    const s = store();
    expect(s.planetSession).toMatchObject({ entryId: 'e1', name: 'Bay' });
    const zones = s.gridState!.cells.map((row) => row.map((c) => c.zone));
    expect(zones).toEqual(deriveBoundary(zones));
    expect(zones.flat()).toContain(CellZone.Boundary);
    const plaza = s.gridState!.objects.get(ANCHOR_LANDMARK.id)!;
    expect(plaza.locked).toBe(false);
    expect(plaza.position.x % 1).toBe(0.5);
  });

  it('keeps the shore rim live around ground edits, undo and redo, outside the history', () => {
    enterPlanetSession(editorPort, null);
    const cells = () => store().gridState!.cells;
    const executor = store().commandExecutor!;
    paintGround(rect(10, 10, 2, 2));
    expect(executor.historyDepth()).toBe(1);
    expect(cells()[9]![9]!.zone).toBe(CellZone.Boundary);
    expect(cells()[12]![12]!.zone).toBe(CellZone.Boundary);
    expect(cells()[8]![8]!.zone).toBe(CellZone.Void);
    executor.execute({ type: CommandType.EraseTerrain, cells: rect(10, 10, 2, 2), ground: CellZone.Void });
    expect(cells().flat().some((c) => c.zone === CellZone.Boundary)).toBe(false);
    executor.undo();
    expect(cells()[9]![9]!.zone).toBe(CellZone.Boundary);
    executor.redo();
    expect(cells()[9]![9]!.zone).toBe(CellZone.Void);
  });

  it('lays the rim over sand painted beside grass and gives the sand back when the grass goes', () => {
    enterPlanetSession(editorPort, null);
    const executor = store().commandExecutor!;
    paintGround(rect(10, 10, 3, 3));
    paintGround([...rect(13, 10, 2, 3)], CellZone.Beach);
    expect(cellAt(13, 11)).toMatchObject({ zone: CellZone.Boundary, under: CellZone.Beach });
    expect(cellAt(14, 11).zone).toBe(CellZone.Beach);
    expect(cellAt(9, 11)).toEqual({ zone: CellZone.Boundary, terrain: null });
    executor.execute({ type: CommandType.EraseTerrain, cells: rect(12, 10, 1, 3), ground: CellZone.Void });
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
    enterPlanetSession(editorPort, null);
    const executor = store().commandExecutor!;
    paintGround(rect(10, 10, 3, 3));
    paintGround([{ x: 13, y: 11 }], CellZone.Beach);
    executor.execute({ type: CommandType.EraseTerrain, cells: [{ x: 13, y: 11 }], ground: CellZone.Void });
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Boundary, terrain: null });
    executor.execute({ type: CommandType.EraseTerrain, cells: rect(12, 10, 1, 3), ground: CellZone.Void });
    expect(cellAt(13, 11)).toEqual({ zone: CellZone.Void, terrain: null });
  });

  it('keeps sand beside grass under a rim through finish, so the saved rim follows the rule', () => {
    enterPlanetSession(editorPort, null);
    paintGround(rect(100, 100, 20, 20));
    paintGround(rect(120, 100, 3, 20), CellZone.Beach);
    const t = sessionPlanet(store().gridState!)!.template;
    const at = (x: number, y: number) => t.zones[y - 96]![x - 96]!;
    expect(at(120, 110)).toBe(CellZone.Boundary);
    expect(at(121, 110)).toBe(CellZone.Beach);
    expect(at(99, 110)).toBe(CellZone.Boundary);
    expect(at(98, 110)).toBe(CellZone.Void);
    expect(t.zones).toEqual(deriveBoundary(t.zones.map((row) => row.map((z) => (z === CellZone.Boundary ? CellZone.Void : z)))));
  });

  it('opens a saved planet with the sand under its rim and keeps it when the grass goes', () => {
    const planet = shoredPlanet(true);
    enterPlanetSession(editorPort, entryOf(planet));
    const cells = store().gridState!.cells;
    const rimRows = cells.map((row) => row.filter((c) => c.zone === CellZone.Boundary));
    const last = rimRows.length - 1 - [...rimRows].reverse().findIndex((row) => row.length > 0);
    // The fixture's grass reaches one row short of its bottom edge, where no sand lies beyond the rim.
    expect(rimRows.slice(0, last).flat().every((c) => c.under === CellZone.Beach)).toBe(true);
    expect(sessionPlanet(store().gridState!)!.template.id).toBe(planet.id);
    const y = rimRows.findIndex((row) => row.length > 0);
    const x = cells[y]!.findIndex((c) => c.zone === CellZone.Boundary);
    store().commandExecutor!.execute({ type: CommandType.EraseTerrain, cells: rect(x, y + 1, 2, 1), ground: CellZone.Void });
    expect(cellAt(x, y)).toEqual({ zone: CellZone.Beach, terrain: null });
  });

  it('announces the rim cells it changed', () => {
    enterPlanetSession(editorPort, null);
    const seen: MacroCoord[] = [];
    const listen = ({ cells }: { cells: readonly CellSet[] }) => { seen.push(...cellsOn(cells, TERRAIN_GRID)); };
    store().eventBus.on('cells-changed', listen);
    paintGround([{ x: 20, y: 20 }]);
    store().eventBus.off('cells-changed', listen);
    expect(seen).toContainEqual({ x: 19, y: 19 });
    expect(seen).toContainEqual({ x: 21, y: 21 });
  });

  it('keeps each editor\'s shore follower when another editor opens a session', () => {
    enterPlanetSession(editorPort, null);
    const side = sideEditor();
    enterPlanetSession(side, null);
    paintGround(rect(10, 10, 2, 2));
    expect(cellAt(9, 9).zone).toBe(CellZone.Boundary);
    leavePlanetSession(side);
  });

  it('stops following the shore once the session ends', () => {
    enterPlanetSession(editorPort, null);
    leavePlanetSession(editorPort);
    const state = store().gridState!;
    const y = state.cells.findIndex((row) => row.some((c, x) => c.zone === CellZone.Grass && row[x + 1]?.zone === CellZone.Grass));
    const x = state.cells[y]!.findIndex((c, i, row) => c.zone === CellZone.Grass && row[i + 1]?.zone === CellZone.Grass);
    state.cells[y]![x]!.zone = CellZone.Void;
    store().eventBus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, [{ x, y }])] });
    expect(state.cells[y]![x]!.zone).toBe(CellZone.Void);
    state.cells[y]![x]!.zone = CellZone.Grass;
  });

  it('a saved planet reopened and finished unchanged keeps its id', () => {
    const planet = shoredPlanet();
    expect(validatePlanetTemplate(planet)).toBeNull();
    enterPlanetSession(editorPort, entryOf(planet));
    const t = sessionPlanet(store().gridState!)!.template;
    expect(t.id).toBe(planet.id);
    expect(templateAnchor(t)!).toEqual(templateAnchor(planet)!);
    expect(Array.from(t.terrain!)).toEqual(Array.from(planet.terrain!));
    expect(t.zones).toEqual(planet.zones);
  });

  it('records a pond on the drawn ground as water, with grass under it and no rim around it', () => {
    enterPlanetSession(editorPort, null);
    paintGround(rect(100, 100, 40, 30));
    const plain = sessionPlanet(store().gridState!)!.template;
    store().commandExecutor!.execute({ type: CommandType.PaintTerrain, cells: rect(110, 110, 3, 2), terrainType: TerrainType.Water, elevation: 0 });
    expect(cellAt(111, 110)).toMatchObject({ zone: CellZone.Grass, terrain: { type: TerrainType.Water, elevation: 0 } });
    const t = sessionPlanet(store().gridState!)!.template;
    expect(t.zones).toEqual(plain.zones);
    expect(t.id).not.toBe(plain.id);
    expect(validatePlanetTemplate(t)).toBeNull();
    const at = (x: number, y: number) => (y - 96) * t.width + x - 96;
    expect(t.water?.[at(111, 110)]).toBe(1);
    expect(t.water?.reduce((n, v) => n + v, 0)).toBe(6);
    leavePlanetSession(editorPort);
    enterPlanetSession(editorPort, entryOf(t));
    expect(sessionPlanet(store().gridState!)!.template.id).toBe(t.id);
  });

  it('crops the drawn ground to whole chunks with a derived shore and no plaza', () => {
    enterPlanetSession(editorPort, null);
    paintGround(rect(100, 100, 50, 40));
    const t = sessionPlanet(store().gridState!)!.template;
    expect(t.width).toBe(64);
    expect(t.height).toBe(48);
    expect(t.chunkGrid).toEqual({ origin: { x: 0, y: 0 }, columns: 4, rows: 3 });
    expect(t.id.startsWith('custom-')).toBe(true);
    expect(t.landmarks).toEqual([]);
    expect(t.zones.flat()).toContain(CellZone.Boundary);
    expect(validatePlanetTemplate(t)).toBeNull();
  });

  it('grows the crop to cover a plaza reaching past the ground', () => {
    enterPlanetSession(editorPort, null);
    paintGround(rect(100, 100, 20, 20));
    const state = store().gridState!;
    state.objects.set(ANCHOR_LANDMARK.id, {
      id: ANCHOR_LANDMARK.id, catalogId: ANCHOR_LANDMARK.id, position: { x: 130.5, y: 99.5 },
      width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height, rotation: 0, elevation: 1, locked: false,
    });
    const t = sessionPlanet(state)!.template;
    expect(t.width).toBe(64);
    expect(t.height).toBe(32);
    expect(t.chunkGrid).toEqual({ origin: { x: 0, y: 0 }, columns: 4, rows: 2 });
    expect(templateAnchor(t)!).toMatchObject({ x: 34.5, y: 3.5, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height });
    expect(templateAnchor(t)!.x + templateAnchor(t)!.width).toBeLessThanOrEqual(t.width);
    expect(templateAnchor(t)!.y + templateAnchor(t)!.height).toBeLessThanOrEqual(t.height);
  });

  it('finish names the planet and stays in the session', () => {
    enterPlanetSession(editorPort, null);
    paintGround(rect(100, 100, 50, 40));
    const r = finishPlanetSession(editorPort, 'Bay');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.template.name).toEqual({ en: 'Bay' });
    expect(store().planetSession).not.toBeNull();
  });

  it('finish refuses a planet with no ground', () => {
    enterPlanetSession(editorPort, null);
    expect(finishPlanetSession(editorPort, 'Bay')).toEqual({ ok: false, reason: 'empty' });
  });

  it('finish outside a session is empty', () => {
    expect(finishPlanetSession(editorPort, 'Bay')).toEqual({ ok: false, reason: 'empty' });
  });
});
