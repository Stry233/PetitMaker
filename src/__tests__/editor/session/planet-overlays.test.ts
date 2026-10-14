// @vitest-environment jsdom
/**
 * The planet session's chunk frame drawn through the view, and one flash when a ground stroke
 * reaches past the canvas edge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { host } from '../../../editor/host/host';
import { CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { installPlanetOverlays } from '../../../editor/session/planet-overlays';
import { startPlanetEditing, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { setStoreState } from '../../_support/store';

const store = () => useEditorStore.getState();
const FLASH_MS = 600;
let uninstall: (() => void) | null = null;
const install = (): void => { uninstall = installPlanetOverlays(FLASH_MS); };

function paintGround(cells: MacroCoord[]): void {
  act(() => {
    store().commandExecutor!.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
  });
}

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

function enter(entry: Parameters<typeof startPlanetEditing>[0] = null): void {
  act(() => { store().setTourRunning(false); startPlanetEditing(entry, false); });
}

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en' });
  newMap(editorPort, 'hexia');
  store().setTourRunning(false);
});

afterEach(() => {
  act(() => { stopPlanetEditing(); });
  host.camera.takeQueued();
  uninstall?.();
  uninstall = null;
  vi.restoreAllMocks();
});

describe('installPlanetOverlays', () => {
  it('draws the live frame through the view and takes it down when stopped', async () => {
    const show = vi.spyOn(host.planetFrame, 'show');
    enter();
    install();
    expect(show).toHaveBeenLastCalledWith(null);
    paintGround(rect(100, 100, 4, 4));
    await waitFor(() => expect(show).toHaveBeenLastCalledWith({ x0: 96, y0: 96, cols: 1, rows: 1 }));
    const calls = show.mock.calls.length;
    paintGround(rect(101, 101, 2, 2));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(show.mock.calls.length, 'an unchanged frame is not redrawn').toBe(calls);
    uninstall?.();
    uninstall = null;
    expect(show).toHaveBeenLastCalledWith(null);
  });

  it('flashes the frame for the duration it was given when a stroke is clipped, only in a session', () => {
    const flash = vi.spyOn(host.planetFrame, 'flash');
    install();
    act(() => { store().eventBus.emit('ground-clipped', {}); });
    expect(flash).not.toHaveBeenCalled();
    enter();
    act(() => { store().eventBus.emit('ground-clipped', {}); });
    expect(flash).toHaveBeenCalledWith(FLASH_MS);
  });

  it('draws only during the session', async () => {
    const show = vi.spyOn(host.planetFrame, 'show');
    install();
    expect(show).not.toHaveBeenCalled();
    enter();
    paintGround(rect(100, 100, 4, 4));
    await waitFor(() => expect(show).toHaveBeenLastCalledWith({ x0: 96, y0: 96, cols: 1, rows: 1 }));
    act(() => { stopPlanetEditing(); });
    expect(show).toHaveBeenLastCalledWith(null);
  });
});
