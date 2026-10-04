/**
 * The planet session's chunk frame drawn through the view, and one flash when a ground stroke
 * reaches past the canvas edge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { newMap } from '../../../../kit/operations/map';
import { host } from '../../../../kit/host';
import { CellZone, CommandType, TerrainType, type MacroCoord } from '../../../../core/model/types';
import { seconds } from '../../../../ui/design/motion';
import { PlanetFrameOverlay } from '../../../../ui/shell/planet/PlanetFrameOverlay';
import { Shell } from '../../../../ui/shell/Shell';
import { startPlanetEditing, stopPlanetEditing } from '../../../../ui/shell/planet/planet-editing';
import { setStoreState } from '../../../_store';

const store = () => useEditorStore.getState();
const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

function paintGround(cells: MacroCoord[]): void {
  act(() => {
    store().commandExecutor!.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
  });
}

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

function enter(entry: Parameters<typeof startPlanetEditing>[0] = null): void {
  act(() => { store().setTourRunning(false); startPlanetEditing(entry); });
}

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en' });
  newMap('hexia');
  store().setTourRunning(false);
});

afterEach(() => {
  act(() => { stopPlanetEditing(); });
  host.camera.takeQueued();
  cleanup();
  vi.restoreAllMocks();
});

describe('PlanetFrameOverlay', () => {
  it('draws the live frame through the view and takes it down on unmount', async () => {
    const show = vi.spyOn(host.planetFrame, 'show');
    enter();
    const view = render(<PlanetFrameOverlay />, { wrapper });
    expect(show).toHaveBeenLastCalledWith(null);
    paintGround(rect(100, 100, 4, 4));
    await waitFor(() => expect(show).toHaveBeenLastCalledWith({ x0: 96, y0: 96, cols: 1, rows: 1 }));
    const calls = show.mock.calls.length;
    paintGround(rect(101, 101, 2, 2));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(show.mock.calls.length, 'an unchanged frame is not redrawn').toBe(calls);
    view.unmount();
    expect(show).toHaveBeenLastCalledWith(null);
  });

  it('flashes the frame for the registry duration when a stroke is clipped', () => {
    const flash = vi.spyOn(host.planetFrame, 'flash');
    enter();
    render(<PlanetFrameOverlay />, { wrapper });
    act(() => { store().eventBus.emit('ground-clipped', {}); });
    expect(flash).toHaveBeenCalledWith(seconds('planet.frame.flash') * 1000);
  });

  it('draws in the shell only during the session', async () => {
    const show = vi.spyOn(host.planetFrame, 'show');
    render(<Shell onRestoreSession={() => {}}><div /></Shell>, { wrapper });
    expect(show).not.toHaveBeenCalled();
    enter();
    paintGround(rect(100, 100, 4, 4));
    await waitFor(() => expect(show).toHaveBeenLastCalledWith({ x0: 96, y0: 96, cols: 1, rows: 1 }));
    act(() => { stopPlanetEditing(); });
    expect(show).toHaveBeenLastCalledWith(null);
  });
});
