// @vitest-environment jsdom
/** The editor session's own rules for an open curve, with no handle component mounted: what ends
 *  its adjust phase and where its footprint draws. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../../../editor/commands/run';
import { installEditorSession } from '../../../editor/session/install';
import { autosave } from '../../../editor/session/autosave';
import { watchCurveSession } from '../../../editor/session/tool-wiring';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { armingOf } from '../../../state/editing/arming';
import { useEditorStore } from '../../../state/store';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { setActiveView } from '../../../view/active-view';
import {
  __resetCurveSession, beginCurveSession, curveArmingKey, endCurveSession, getCurveSession, moveCurveAnchor,
} from '../../_support/curve-session';
import { makeState } from '../../_support/map-state';
import { resetStore } from '../../_support/store';

const s = () => useEditorStore.getState();
const owner = () => ({ preview: vi.fn(), repaint: vi.fn(), finalize: vi.fn() });
const overlayView = (): ActiveView => ({ overlay: { showCurveFootprint: vi.fn(), clearCurveFootprint: vi.fn() } }) as unknown as ActiveView;
const ANCHORS = [{ x: 2, y: 2 }, { x: 8, y: 2 }];

/** A curve drawn under what the store has armed now. */
function openCurve(host = owner()) {
  beginCurveSession(ANCHORS, { width: 1, grid: 'terrain', armingKey: curveArmingKey(armingOf(s())) }, host);
  return host;
}

let stop = (): void => {};

beforeEach(() => {
  localStorage.clear();
  resetStore();
  s().loadMap(makeState(16, 16), createDefaultRegistry());
  stop = installEditorSession({ frameFlashMs: 0 });
});

afterEach(() => {
  stop();
  __resetCurveSession();
  setActiveView(null);
  autosave.clear();
  localStorage.clear();
});

describe('an open curve with the session installed and no handles mounted', () => {
  it('ends when an undo or a redo lands on the map, re-laying nothing', async () => {
    s().commandExecutor!.execute(paintTerrainCommand([{ x: 2, y: 2 }], TerrainType.Mountain, 1));
    for (const step of ['history.undo', 'history.redo']) {
      const host = openCurve();
      expect(await runCommand(step)).toMatchObject({ ok: true });
      expect(getCurveSession(), step).toBeNull();
      expect(host.finalize, step).toHaveBeenCalledOnce();
      expect(host.repaint, step).not.toHaveBeenCalled();
    }
  });

  it('[EDIT-37] ends when the shape, the surface or the armed tool it was drawn under changes', () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'erase' } });
    s().setEraserShape('curve');
    const changes: [string, () => void][] = [
      ['shape', () => s().setEraserShape('line')],
      ['surface', () => s().setEditMode({ mode: 'water' })],
      ['armed tool', () => useEditorStore.setState((state) => ({ armingEpoch: state.armingEpoch + 1 }))],
    ];
    for (const [what, change] of changes) {
      const host = openCurve();
      change();
      expect(getCurveSession(), what).toBeNull();
      expect(host.finalize, what).toHaveBeenCalledOnce();
    }
  });

  it('stays open through store updates that leave its arming alone, and ends with the session', () => {
    const host = openCurve();
    s().setBrushSize(3);
    s().toggleGrid();
    expect(getCurveSession()).not.toBeNull();
    stop();
    stop = () => {};
    expect(getCurveSession()).toBeNull();
    expect(host.finalize).toHaveBeenCalledOnce();
  });

});

describe('an open curve\'s footprint, drawn by the session\'s curve watch alone', () => {
  beforeEach(() => {
    // The whole session's other view syncs would paint on the bare overlays below.
    stop();
    stop = watchCurveSession();
  });

  it('keeps an eraser curve\'s footprint on the active view, through a view swap, an anchor move and a map edit', () => {
    const first = overlayView();
    setActiveView(first);
    beginCurveSession(ANCHORS, { width: 3, grid: 'terrain', footprint: true }, owner());
    expect(first.overlay.showCurveFootprint).toHaveBeenLastCalledWith({ grid: 'terrain', cells: expect.arrayContaining([{ x: 5, y: 1 }, { x: 5, y: 3 }]) });
    const second = overlayView();
    setActiveView(second);
    expect(first.overlay.clearCurveFootprint).toHaveBeenCalled();
    expect(second.overlay.showCurveFootprint).toHaveBeenCalledTimes(1);
    moveCurveAnchor(1, 8, 8, true);
    expect(second.overlay.showCurveFootprint).toHaveBeenLastCalledWith({ grid: 'terrain', cells: expect.arrayContaining([{ x: 8, y: 8 }]) });
    const drawn = vi.mocked(second.overlay.showCurveFootprint).mock.calls.length;
    s().commandExecutor!.execute(paintTerrainCommand([{ x: 12, y: 12 }], TerrainType.Mountain, 1));
    expect(vi.mocked(second.overlay.showCurveFootprint).mock.calls.length, 'drawn again over the edited map').toBeGreaterThan(drawn);
    endCurveSession();
    expect(second.overlay.clearCurveFootprint).toHaveBeenCalled();
  });

  it('draws no footprint for a curve that keeps none', () => {
    const view = overlayView();
    setActiveView(view);
    openCurve();
    expect(view.overlay.showCurveFootprint).not.toHaveBeenCalled();
  });
});
