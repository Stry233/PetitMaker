// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { host } from '../../../editor/host/host';
import { readAutosave } from '../../../io/storage/autosave';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../io/storage/facts';
import { autosave } from '../../../editor/session/autosave';
import { listPlanets, savePlanet, settlePlanetName, shownAs } from '../../../io/storage/planet-library';
import { defaultPlanetName, shownPlanetName } from '../../../editor/session/planet-names';
import { PREFS } from '../../../platform/storage/prefs';
import { CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { CellZone, type GroundZone } from '../../../core/game/zones';
import { finishPlanetEditing as finishWithShown, startPlanetEditing as start, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { useSessionPlanetName } from '../../../ui/shell/planet/use-planet-session';
import { renderHook } from '@testing-library/react';
import { planetFixture } from '../../_support/planet';

const store = () => useEditorStore.getState();
/** The name the nameplate shows the session planet under. */
const sessionPlanetName = (): string => renderHook(() => useSessionPlanetName()).result.current;
const startPlanetEditing = (source: Parameters<typeof start>[0]): boolean => start(source, false);
/** Finishes as the nameplate does, against the name it shows. */
const finishPlanetEditing = (name: string, asCopy: boolean) => finishWithShown(name, asCopy, sessionPlanetName());

function paint(cells: MacroCoord[], ground = true): void {
  store().commandExecutor!.execute(ground
    ? { type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass }
    : { type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 1 });
}

function paintGround(cells: MacroCoord[], ground: GroundZone): void {
  store().commandExecutor!.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground });
}

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

function island(): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = 100; y < 140; y++) for (let x = 100; x < 150; x++) cells.push({ x, y });
  return cells;
}

describe('planet editing', () => {
  beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); });
  afterEach(() => { stopPlanetEditing(); host.camera.takeQueued(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('a failed entry resumes autosave over the parked map', () => {
    const grid = store().gridState!;
    const original = store().setPlanetMaterial;
    useEditorStore.setState({ setPlanetMaterial: () => { throw new Error('install'); } });
    try {
      expect(() => startPlanetEditing(null)).toThrow('install');
    } finally {
      useEditorStore.setState({ setPlanetMaterial: original });
    }
    expect(store().planetSession).toBeNull();
    expect(store().gridState).toBe(grid);
    expect(autosave.isSuspended()).toBe(false);
  });

  it('folds the assistant away as the session opens', () => {
    store().setAssistantOpen(true);
    expect(startPlanetEditing(null)).toBe(true);
    expect(store().assistantOpen).toBe(false);
  });

  it('a save pending at entry is flushed with the parked map', () => {
    vi.useFakeTimers();
    paint([{ x: 80, y: 40 }], false);
    const grid = store().gridState!;
    autosave.schedule(grid);
    expect(localStorage.getItem(PREFS.autosave.key)).toBeNull();
    startPlanetEditing(null);
    expect(autosave.isSuspended()).toBe(true);
    const flushed = localStorage.getItem(PREFS.autosave.key);
    expect(flushed).not.toBeNull();
    expect(readAutosave()!.state.template.id).toBe(grid.template.id);
    expect(readAutosave()!.state.cells[40]![80]!.terrain?.elevation).toBe(1);

    paint(island());
    autosave.schedule(store().gridState!);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(localStorage.getItem(PREFS.autosave.key)).toBe(flushed);

    stopPlanetEditing();
    expect(autosave.isSuspended()).toBe(false);
    expect(store().gridState).toBe(grid);
  });

  it('queues the cameras read on entry for the views on leave', () => {
    const camera = { x: 3, y: 4, zoom: 2 };
    vi.spyOn(host.camera, 'get2d').mockReturnValue(camera);
    startPlanetEditing(null);
    stopPlanetEditing();
    expect(host.camera.takeQueued()).toEqual({ view2d: camera });
  });

  it('resumes autosave when entering fails', () => {
    vi.spyOn(host.camera, 'get2d').mockImplementation(() => { throw new Error('no view'); });
    expect(() => startPlanetEditing(null)).toThrow('no view');
    expect(store().planetSession).toBeNull();
    expect(autosave.isSuspended()).toBe(false);
  });

  it('resumes autosave when leaving fails', () => {
    startPlanetEditing(null);
    vi.spyOn(store(), 'restoreParkedEditor').mockImplementation(() => { throw new Error('broken'); });
    expect(() => stopPlanetEditing()).toThrow('broken');
    expect(autosave.isSuspended()).toBe(false);
    vi.restoreAllMocks();
    stopPlanetEditing();
  });

  it('finish saves the cropped planet and leaves the map untouched', () => {
    const grid = store().gridState;
    const executor = store().commandExecutor;
    startPlanetEditing(null);
    paint(island());
    const r = finishPlanetEditing('Bay', false);
    expect(r.ok).toBe(true);
    const planets = listPlanets();
    expect(planets).toHaveLength(1);
    expect(planets[0]!.name).toBe('Bay');
    expect(planets[0]!.template.width % 16).toBe(0);
    expect(planets[0]!.template.id.startsWith('custom-')).toBe(true);
    if (r.ok) expect(r.entry.entryId).toBe(planets[0]!.entryId);
    expect(store().gridState).toBe(grid);
    expect(store().commandExecutor).toBe(executor);
    expect(store().planetSession).toBeNull();
    expect(autosave.isSuspended()).toBe(false);
  });

  it('finish replaces the planet being edited, or adds a copy', () => {
    const saved = savePlanet('Bay', planetFixture());
    if (!saved.ok) throw new Error('fixture save failed');
    startPlanetEditing(saved.entry);
    paint(island());
    expect(finishPlanetEditing('Cove', false).ok).toBe(true);
    expect(listPlanets().map((e) => [e.entryId, e.name])).toEqual([[saved.entry.entryId, 'Cove']]);

    startPlanetEditing(listPlanets()[0]!);
    expect(finishPlanetEditing('Cove copy', true).ok).toBe(true);
    expect(listPlanets().map((e) => e.name)).toEqual(['Cove', 'Cove copy']);
  });

  it('finish refuses a planet with no ground and stays in the session', () => {
    startPlanetEditing(null);
    expect(finishPlanetEditing('Bay', false)).toEqual({ ok: false, reason: 'empty' });
    expect(store().planetSession).not.toBeNull();
    expect(autosave.isSuspended()).toBe(true);
  });

  it('keeps an unchecked name through a save under its default name, and shows it once the check approves', () => {
    const saved = savePlanet('Harbour', planetFixture(), { nameReviewed: false });
    if (!saved.ok) throw new Error('fixture save failed');
    const fallback = defaultPlanetName('en', 0);
    startPlanetEditing(shownAs(saved.entry, fallback));
    expect(store().planetSession).toMatchObject({ entryId: saved.entry.entryId, name: 'Harbour', nameReviewed: false });
    expect(sessionPlanetName()).toBe(fallback);
    paint(island());
    expect(finishPlanetEditing(fallback, false).ok).toBe(true);
    expect(listPlanets().map((e) => [e.entryId, e.name, e.nameReviewed])).toEqual([[saved.entry.entryId, 'Harbour', false]]);
    expect(settlePlanetName(saved.entry.entryId, 'Harbour', null)).toBe(true);
    expect(shownPlanetName(listPlanets()[0]!.template, 'en')).toBe('Harbour');
  });

  it('shows an unchecked name in the session once the check approves it, and saves a typed name as checked', () => {
    const saved = savePlanet('Harbour', planetFixture(), { nameReviewed: false });
    if (!saved.ok) throw new Error('fixture save failed');
    startPlanetEditing(saved.entry);
    expect(store().gridState!.template.name.en).toBe('');
    settlePlanetName(saved.entry.entryId, 'Harbour', null);
    expect(sessionPlanetName()).toBe('Harbour');
    expect(finishPlanetEditing('Cove', false).ok).toBe(true);
    expect(listPlanets().map((e) => [e.name, e.nameReviewed])).toEqual([['Cove', true]]);
  });

  it('keeps the sand painted under the rim through Done and reopening', () => {
    startPlanetEditing(null);
    paint(rect(100, 100, 20, 20));
    // A one-cell sand ring against the grass lies wholly under the rim.
    const ring = rect(99, 99, 22, 22).filter(({ x, y }) => x === 99 || x === 120 || y === 99 || y === 120);
    paintGround(ring, CellZone.Beach);
    // A rim over sea with sand beyond it on the right.
    paint(rect(100, 125, 20, 3));
    paintGround(rect(100, 129, 20, 1), CellZone.Beach);
    expect(finishPlanetEditing('Bay', false).ok).toBe(true);

    startPlanetEditing(listPlanets()[0]!);
    const cells = store().gridState!.cells;
    const gy = cells.findIndex((row) => row.some((c) => c.zone === CellZone.Grass));
    const gx = cells[gy]!.findIndex((c) => c.zone === CellZone.Grass);
    const erase = (cells: MacroCoord[]) => store().commandExecutor!.execute({ type: CommandType.EraseTerrain, cells, ground: CellZone.Void });
    erase(rect(gx, gy, 1, 20));
    expect(store().gridState!.cells[gy + 10]![gx - 1]!.zone).toBe(CellZone.Beach);
    erase(rect(gx, gy + 27, 20, 1));
    expect(store().gridState!.cells[gy + 28]![gx + 10]!.zone).toBe(CellZone.Void);
    expect(store().gridState!.cells[gy + 29]![gx + 10]!.zone).toBe(CellZone.Beach);
  });

  it('a save the library cannot hold keeps the session open', () => {
    startPlanetEditing(null);
    paint(island());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(finishPlanetEditing('Bay', false)).toEqual({ ok: false, reason: 'quota' });
    expect(store().planetSession).not.toBeNull();
    expect(autosave.isSuspended()).toBe(true);
  });
});
