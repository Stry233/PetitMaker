// @vitest-environment jsdom
/** The editor session's wiring: when the session is autosaved, and the restore of a saved session. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { installEditorSession } from '../../../editor/session/install';
import { readRestoreOffer, restoreSession } from '../../../editor/session/restore';
import { autosave } from '../../../editor/session/autosave';
import { editorPort } from '../../../editor/session/context';
import { loadMap, newMap } from '../../../editor/operations';
import { createAutosave, readAutosave } from '../../../io/storage/autosave';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../io/storage/facts';
import { listPlanets } from '../../../io/storage/planet-library';
import { PREFS } from '../../../platform/storage/prefs';
import { takeParkedCamera } from '../../../view/shared/viewport/parked-camera';
import { createGridState } from '../../../core/model/template';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem } from '../../../state/catalog';
import type { PersistedCamera } from '../../../io/save/format';
import { planetFixture } from '../../_support/planet';
import { versionStore } from '../../../state/stylize-versions';
import { builtMap } from '../../spec/files/_files';

let stops: (() => void)[] = [];
const install = (): void => { stops.push(installEditorSession({ frameFlashMs: 0 })); };
const uninstall = (): void => { for (const stop of stops.splice(0)) stop(); };
const store = () => useEditorStore.getState();
const stored = (): string | null => localStorage.getItem(PREFS.autosave.key);
const settle = (): void => { vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS); };

/** A session an earlier visit left in this browser: a built map, autosaved with `camera`. */
function waitingSession(camera?: PersistedCamera): string {
  const w = builtMap();
  createAutosave({ camera: () => camera, history: () => undefined }).schedule(w.state);
  settle();
  return stored()!;
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => {
  uninstall();
  autosave.clear();
  useEditorStore.setState({ planetSession: null });
  vi.useRealTimers();
  localStorage.clear();
});

describe('installEditorSession autosave triggers', () => {
  it('[FILE-17] never lets the empty starting map overwrite a waiting session, through remounts, while a replacement map is saved', () => {
    const session = waitingSession();
    newMap(editorPort, 'hexia');
    // StrictMode's double effect installs, stops and installs again.
    install(); uninstall(); install();
    settle();
    expect(stored()).toBe(session);
    act(() => newMap(editorPort, 'tafa'));
    settle();
    expect(stored()).not.toBe(session);
    expect(readAutosave()?.state.template.id).toBe('tafa');
  });

  it('[FILE-17] treats the first map installed after none as the starting map', () => {
    const session = waitingSession();
    useEditorStore.setState({ gridState: null, commandExecutor: null, planetSession: null });
    install();
    act(() => newMap(editorPort, 'hexia'));
    settle();
    expect(stored()).toBe(session);
  });

  it('[FILE-16] saves a new title and new annotations on the same map', () => {
    newMap(editorPort, 'hexia');
    install();
    act(() => store().setMapNotes({ title: 'Garden' }));
    settle();
    expect(readAutosave()?.state.notes?.title).toBe('Garden');
    act(() => store().addAnnotation({ kind: 'zone', id: 'zone-1', cells: [{ x: 30, y: 30 }], color: '#FF8A7A', tag: null, num: 1, size: 'm' }));
    settle();
    expect(readAutosave()?.state.annotations?.items.map((a) => a.id)).toEqual(['zone-1']);
  });

  it('keeps the stored session through a planet session\'s map and edits', () => {
    const session = waitingSession();
    newMap(editorPort, 'hexia');
    install();
    const parked = {} as NonNullable<ReturnType<typeof useEditorStore.getState>['planetSession']>['parked'];
    act(() => useEditorStore.setState({ planetSession: { entryId: null, name: '', nameReviewed: true, parked } }));
    const scratch = createGridState(planetFixture());
    act(() => loadMap(editorPort, scratch));
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: 38, y: 26 }, 0, scratch, { id: 'tree' });
    act(() => { expect(store().commandExecutor!.execute(placeObjectCommand(tree)).success).toBe(true); });
    settle();
    expect(stored()).toBe(session);
  });
});

describe('installEditorSession stylize takes', () => {
  it('retires the takes on a map edit while the illustration window is closed', () => {
    versionStore.reset();
    useEditorStore.setState({ gridState: makeState() });
    install();
    versionStore.mint({ kind: 'model', direction: 'watercolor', image: {} as HTMLImageElement, mapEdit: versionStore.currentMapEdit() });
    act(() => useEditorStore.getState().eventBus.emit('objects-changed', {}));
    expect(versionStore.getState().versions).toEqual([]);
    versionStore.reset();
  });
});

describe('restoreSession', () => {
  it('[FILE-17] parks the saved cameras on the restored map, where each view takes its own', () => {
    const camera = { view2d: { zoom: 2, x: 40, y: 30 }, view3d: { az: 30, el: 25, dist: 0.6, tx: 2, tz: -3 } };
    waitingSession(camera);
    newMap(editorPort, 'hexia');
    const startup = store().gridState;
    restoreSession(readRestoreOffer()!);
    const restored = store().gridState!;
    expect(restored).not.toBe(startup);
    expect(takeParkedCamera(restored, 'view2d')).toEqual(camera.view2d);
    expect(takeParkedCamera(restored, 'view3d')).toEqual(camera.view3d);
  });
  it('adds the planet of an accepted restore to the library', () => {
    localStorage.clear();
    useEditorStore.setState({ gridState: makeState() });
    const map = createGridState(planetFixture());
    restoreSession({ state: map });
    expect(listPlanets().map((e) => e.template.id)).toEqual([map.template.id]);
  });
});
