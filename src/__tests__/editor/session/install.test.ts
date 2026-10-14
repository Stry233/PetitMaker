// @vitest-environment jsdom
/** The editor session's wiring: when an autosave is scheduled, and the restore of a saved session. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { installEditorSession } from '../../../editor/session/install';
import { restoreSession } from '../../../editor/session/restore';
import { autosave } from '../../../editor/session/autosave';
import { host } from '../../../editor/host/host';
import { listPlanets } from '../../../io/storage/planet-library';
import { createGridState } from '../../../core/model/template';
import { planetFixture } from '../../_support/planet';
import { versionStore } from '../../../state/stylize-versions';

vi.mock('../../../editor/session/autosave', () => ({ autosave: { schedule: vi.fn() } }));
vi.mock('../../../editor/session/editor-tools', () => ({ startEditorTools: () => () => {} }));
vi.mock('../../../view/shared/overlay/selection-view-sync', () => ({ installSelectionViewSync: () => () => {} }));
vi.mock('../../../view/shared/overlay/overlay-view-sync', () => ({ installOverlayViewSync: () => () => {} }));
vi.mock('../../../editor/operations/map', () => ({ loadMap: (_host: unknown, state: ReturnType<typeof makeState>) => useEditorStore.setState({ gridState: state }) }));
vi.mock('../../../editor/host/host', () => ({ host: {
  camera: { queue: vi.fn() },
  planetFrame: { show: vi.fn(), flash: vi.fn() },
  planetReview: { show: vi.fn() },
} }));

let stops: (() => void)[] = [];
const install = (): void => { stops.push(installEditorSession({ frameFlashMs: 0 })); };
const uninstall = (): void => { for (const stop of stops.splice(0)) stop(); };
afterEach(() => { uninstall(); vi.clearAllMocks(); });

describe('installEditorSession autosave triggers', () => {
  it('distinguishes initialization and remounts from replacing an active map', () => {
    const initial = makeState();
    useEditorStore.setState({ gridState: initial, planetSession: null });
    // StrictMode's double effect installs, stops and installs again.
    install(); uninstall(); install();
    expect(vi.mocked(autosave.schedule).mock.calls.every(([, reason]) => reason === 'initialize')).toBe(true);
    vi.mocked(autosave.schedule).mockClear();
    const replacement = makeState();
    act(() => useEditorStore.setState({ gridState: replacement }));
    expect(autosave.schedule).toHaveBeenCalledExactlyOnceWith(replacement);
    uninstall();
    vi.mocked(autosave.schedule).mockClear();
    install();
    expect(autosave.schedule).toHaveBeenCalledExactlyOnceWith(replacement, 'initialize');
  });

  it('treats the first grid installation as initialization', () => {
    useEditorStore.setState({ gridState: null, planetSession: null });
    install();
    const initial = makeState();
    act(() => useEditorStore.setState({ gridState: initial }));
    expect(autosave.schedule).toHaveBeenCalledExactlyOnceWith(initial, 'initialize');
  });

  it('persists captions as well as annotations when the map reference stays the same', () => {
    const map = makeState();
    useEditorStore.setState({ gridState: map, annotationsEpoch: 0 });
    install();
    vi.mocked(autosave.schedule).mockClear();
    act(() => useEditorStore.getState().setMapNotes({ title: 'Garden' }));
    expect(autosave.schedule).toHaveBeenLastCalledWith(map);
    vi.mocked(autosave.schedule).mockClear();
    act(() => useEditorStore.setState({ annotationsEpoch: 1 }));
    expect(autosave.schedule).toHaveBeenLastCalledWith(map);
  });
  it('schedules no autosave while a planet session is open', () => {
    const map = makeState();
    useEditorStore.setState({ gridState: map, planetSession: null });
    install();
    const parked = {} as NonNullable<ReturnType<typeof useEditorStore.getState>['planetSession']>['parked'];
    act(() => useEditorStore.setState({ planetSession: { entryId: null, name: '', nameReviewed: true, parked } }));
    vi.mocked(autosave.schedule).mockClear();
    act(() => useEditorStore.setState({ gridState: makeState() }));
    act(() => useEditorStore.getState().eventBus.emit('cells-changed', { cells: [] } as never));
    expect(autosave.schedule).not.toHaveBeenCalled();
    act(() => useEditorStore.setState({ planetSession: null }));
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
  it('installs the saved map, then parks its camera on it', () => {
    useEditorStore.setState({ gridState: makeState() });
    const map = makeState();
    const camera = { view2d: { zoom: 2, x: 40, y: 30 } };
    vi.mocked(host.camera.queue).mockImplementationOnce(() => { expect(useEditorStore.getState().gridState).toBe(map); });
    restoreSession({ state: map, camera });
    expect(useEditorStore.getState().gridState).toBe(map);
    expect(host.camera.queue).toHaveBeenCalledWith(camera);
  });
  it('adds the planet of an accepted restore to the library', () => {
    localStorage.clear();
    useEditorStore.setState({ gridState: makeState() });
    const map = createGridState(planetFixture());
    restoreSession({ state: map });
    expect(listPlanets().map((e) => e.template.id)).toEqual([map.template.id]);
  });
});
