// @vitest-environment jsdom
/** The settings and switches run by id: each does what its control does, and a bad value changes nothing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../io/storage/local-reset', () => ({ resetAllLocalData: vi.fn(() => Promise.resolve()) }));

import { isChunkLoadEnforced } from '../../../core/model/load';
import { listCommands, runCommand } from '../../../editor/commands/run';
import { resetAllLocalData } from '../../../io/storage/local-reset';
import { PREFS, readPref } from '../../../platform/storage/prefs';
import { createDefaultRegistry } from '../../../rules';
import { PRESETS } from '../../../state/keymap/registry';
import { detectPreset } from '../../../state/keymap/resolve';
import { useKeybinds } from '../../../state/keymap/store';
import { FIRST_TOUR_PHASE } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { TOUR_VERSION } from '../../../state/tour-offer';
import { registerUiZoomReach } from '../../../state/ui-zoom-reach';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { setActiveView } from '../../../view/active-view';
import { makeTemplate } from '../../_support/map-state';

const s = () => useEditorStore.getState();
const current = (id: string) => listCommands().find((command) => command.id === id)?.current;
const run = async (id: string, args: Record<string, unknown> = {}) => {
  const outcome = await runCommand(id, args);
  expect(outcome, `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: true });
};
const refused = async (id: string, args: Record<string, unknown> = {}) => {
  const outcome = await runCommand(id, args);
  expect(outcome.ok, `${id} ${JSON.stringify(args)}`).toBe(false);
  expect(outcome.ok === false && outcome.reason.length).toBeGreaterThan(0);
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
  s().setPlanetSession(null);
  s().setAssistantOpen(false);
  useKeybinds.getState().resetAll();
});

afterEach(() => {
  setActiveView(null);
  s().setPlanetSession(null);
});

describe('settings and switches run by id', () => {
  it('settings.quality_3d sets and saves the 3D quality, and refuses a quality that is none', async () => {
    for (const value of ['lite', 'full', 'auto'] as const) {
      await run('settings.quality_3d', { value });
      expect(s().quality3d).toBe(value);
      expect(readPref('quality3d')).toBe(value);
      expect(current('settings.quality_3d')).toBe(value);
    }
    await refused('settings.quality_3d', { value: 'ultra' });
    expect(s().quality3d).toBe('auto');
  });

  it('settings.system_cursors switches and saves the cursor set, and refuses a value that is no switch', async () => {
    await run('settings.system_cursors', { on: true });
    expect(s().systemCursors).toBe(true);
    expect(readPref('systemCursors')).toBe(true);
    await refused('settings.system_cursors', { on: 'system' });
    expect(s().systemCursors).toBe(true);
    await run('settings.system_cursors', { on: false });
    expect(current('settings.system_cursors')).toBe(false);
  });

  it('map.load_enforced switches the open map\'s regional load limit, and refuses a missing value', async () => {
    await run('map.load_enforced', { on: false });
    expect(isChunkLoadEnforced(s().gridState!)).toBe(false);
    expect(readPref('enforceChunkLoad')).toBe(false);
    expect(current('map.load_enforced')).toBe(false);
    await refused('map.load_enforced');
    expect(isChunkLoadEnforced(s().gridState!)).toBe(false);
    await run('map.load_enforced', { on: true });
    expect(isChunkLoadEnforced(s().gridState!)).toBe(true);
  });

  it('planet.review_shown switches a planet session\'s cells to check, and is refused where none is edited', async () => {
    await refused('planet.review_shown', { on: false });
    expect(s().planetReviewShown).toBe(true);
    s().setPlanetSession({ review: { cells: [], landmark: false } } as unknown as Parameters<ReturnType<typeof s>['setPlanetSession']>[0]);
    await run('planet.review_shown', { on: false });
    expect(s().planetReviewShown).toBe(false);
    await refused('planet.review_shown', { on: 0 });
    expect(s().planetReviewShown).toBe(false);
    await run('planet.review_shown', { on: true });
    expect(current('planet.review_shown')).toBe(true);
  });

  it('app.assistant opens and closes the assistant\'s panel, and does not open it over a planet being edited', async () => {
    await run('app.assistant', { on: true });
    expect(s().assistantOpen).toBe(true);
    expect(current('app.assistant')).toBe(true);
    await run('app.assistant', { on: false });
    expect(s().assistantOpen).toBe(false);
    s().setPlanetSession({} as unknown as Parameters<ReturnType<typeof s>['setPlanetSession']>[0]);
    await refused('app.assistant', { on: true });
    await refused('app.assistant', { on: 'open' });
    expect(s().assistantOpen).toBe(false);
  });

  it('assistant.pinned and assistant.dock_side set and save where the panel docks, and refuse a side that is none', async () => {
    await run('assistant.pinned', { on: true });
    expect(s().assistantPinned).toBe(true);
    expect(readPref('assistantPinned')).toBe(true);
    await run('assistant.dock_side', { value: 'right' });
    expect(s().assistantDockSide).toBe('right');
    expect(readPref('assistantDockSide')).toBe('right');
    expect(current('assistant.dock_side')).toBe('right');
    await refused('assistant.dock_side', { value: 'top' });
    await refused('assistant.pinned', { on: 'yes' });
    expect(s().assistantDockSide).toBe('right');
    expect(s().assistantPinned).toBe(true);
    await run('assistant.pinned', { on: false });
    await run('assistant.dock_side', { value: 'left' });
  });

  it('camera.turn turns the view one step as its turn buttons do, and refuses another direction or no view', async () => {
    await refused('camera.turn', { direction: 'left' });
    const turnStep = vi.fn();
    setActiveView({ camera: { turnStep } } as unknown as ActiveView);
    await run('camera.turn', { direction: 'left' });
    await run('camera.turn', { direction: 'right' });
    expect(turnStep.mock.calls).toEqual([[-1], [1]]);
    await refused('camera.turn', { direction: 'up' });
    await refused('camera.turn');
    expect(turnStep).toHaveBeenCalledTimes(2);
  });

  it('view.fullscreen enters and leaves fullscreen within the press, and refuses a bad value or a browser without it', async () => {
    await refused('view.fullscreen');
    let fullscreen: Element | null = null;
    const request = vi.fn(async () => { fullscreen = document.documentElement; });
    const exit = vi.fn(async () => { fullscreen = null; });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    try {
      await refused('view.fullscreen', { on: 'yes' });
      expect(request).not.toHaveBeenCalled();
      const pressed = runCommand('view.fullscreen');
      expect(request).toHaveBeenCalledTimes(1);
      expect(await pressed).toMatchObject({ ok: true });
      expect(current('view.fullscreen')).toBe(true);
      await run('view.fullscreen', { on: true });
      expect(request).toHaveBeenCalledTimes(1);
      await run('view.fullscreen', { on: false });
      expect(exit).toHaveBeenCalledTimes(1);
      expect(current('view.fullscreen')).toBe(false);
    } finally {
      for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
      delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
    }
  });

  it('tour.start opens the welcome tips on their first card, and not over a planet being edited', async () => {
    s().setPlanetSession({} as unknown as Parameters<ReturnType<typeof s>['setPlanetSession']>[0]);
    await refused('tour.start');
    s().setPlanetSession(null);
    await refused('tour.start', { card: 2 });
    expect(s().tourRunning).toBe(false);
    await run('tour.start');
    expect(s().tourRunning).toBe(true);
    expect(s().tourPhase).toEqual(FIRST_TOUR_PHASE);
    expect(localStorage.getItem(PREFS.tourSeen.key)).toBe(String(TOUR_VERSION));
    s().finishTour();
  });

  it('app.ui_zoom_in and app.ui_zoom_out step the interface size one stop, within the reach the window publishes', async () => {
    s().setUiZoom(1);
    await run('app.ui_zoom_in');
    expect(s().uiZoom).toBe(1.05);
    await run('app.ui_zoom_out');
    await run('app.ui_zoom_out');
    expect(s().uiZoom).toBe(0.95);
    await refused('app.ui_zoom_in', { steps: 3 });
    expect(s().uiZoom).toBe(0.95);
    const off = registerUiZoomReach(() => 1.02);
    try {
      await run('app.ui_zoom_in');
      await run('app.ui_zoom_in');
      expect(s().uiZoom).toBe(1);
      await run('settings.interface_zoom', { value: 1.6 });
      expect(s().uiZoom).toBe(1);
    } finally {
      off();
      s().setUiZoom(1);
    }
  });

  it('app.whats_this turns the What\'s this pick on and off, and not over the running tour', async () => {
    await run('app.whats_this');
    expect(s().whatsThis).toBe(true);
    await refused('app.whats_this', { on: true });
    expect(s().whatsThis).toBe(true);
    await run('app.whats_this');
    expect(s().whatsThis).toBe(false);
    s().startTour(TOUR_VERSION);
    await run('app.whats_this');
    expect(s().whatsThis).toBe(false);
    s().finishTour();
  });

  it('keymap.preset applies a shortcut style, and refuses a style that is none', async () => {
    expect(current('keymap.preset')).toBe('default');
    for (const preset of PRESETS) {
      await run('keymap.preset', { value: preset.id });
      expect(detectPreset(useKeybinds.getState().overrides)).toBe(preset.id);
      expect(current('keymap.preset')).toBe(preset.id);
    }
    const before = useKeybinds.getState().overrides;
    await refused('keymap.preset', { value: 'custom' });
    expect(useKeybinds.getState().overrides).toBe(before);
  });

  it('keymap.reset returns every key to the shipped one, and takes no argument', async () => {
    useKeybinds.getState().rebind('camera.fit', 'shift+9');
    const assigned = useKeybinds.getState().overrides;
    await refused('keymap.reset', { all: true });
    expect(useKeybinds.getState().overrides).toBe(assigned);
    await run('keymap.reset');
    expect(useKeybinds.getState().overrides).toEqual({});
  });

  it('app.reset_local_data runs the full reset once, and takes no argument', async () => {
    await refused('app.reset_local_data', { keep: 'map' });
    expect(resetAllLocalData).not.toHaveBeenCalled();
    await run('app.reset_local_data');
    expect(resetAllLocalData).toHaveBeenCalledTimes(1);
  });
});
