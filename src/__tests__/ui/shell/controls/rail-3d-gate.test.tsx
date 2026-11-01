// @vitest-environment jsdom
/**
 * The rail runs the same command bodies the keyboard does: the 3D toggle on a device without WebGL2
 * says why in one toast from either, and Undo and Redo step the lane the mode keeps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { Rail } from '../../../../ui/shell/Rail';
import { COMMAND_BY_ID } from '../../../../editor/commands/commands';
import { setToastPresenter } from '../../../../platform/channels/toast-bus';
import { createExecutor } from '../../../../state/executor';
import { createDefaultRegistry } from '../../../../rules';
import { makeState } from '../../../_support/map-state';
import { CommandType, TerrainType } from '../../../../core/model/types';

const gl = vi.hoisted(() => ({ webgl2: true }));
vi.mock('../../../../platform/device/device-quality', async (orig) => ({
  ...(await orig<object>()),
  hasWebGL2: () => gl.webgl2,
}));

const toast = { show: vi.fn() };
let releaseToasts: (() => void) | null = null;

const toggle = () => screen.getByLabelText('Switch view');

beforeEach(() => {
  window.innerHeight = 900;
  toast.show.mockClear();
  releaseToasts = setToastPresenter(toast.show);
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, viewMode: '2d', uiZoom: 1,
  });
});
afterEach(() => { cleanup(); gl.webgl2 = true; releaseToasts?.(); });

function mount() {
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

describe('the view toggle without WebGL2', () => {
  it('reads as unavailable and says so instead of switching', () => {
    gl.webgl2 = false;
    mount();
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(toggle());
    expect(useEditorStore.getState().viewMode).toBe('2d');
    expect(toast.show.mock.calls).toEqual([
      ['The 3D view could not start in this browser, so the map stays in 2D.', 'error'],
    ]);
  });

  it('switches the view where the device can draw it', () => {
    mount();
    expect(toggle().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(toggle());
    expect(useEditorStore.getState().viewMode).toBe('3d');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('says the same thing from the keyboard', () => {
    gl.webgl2 = false;
    COMMAND_BY_ID.get('view.toggle')!.run({ toggleMenu: () => {} });
    expect(useEditorStore.getState().viewMode).toBe('2d');
    expect(toast.show.mock.calls).toEqual([
      ['The 3D view could not start in this browser, so the map stays in 2D.', 'error'],
    ]);
  });
});

describe('the history pair while a region is painted', () => {
  const undo = () => screen.getByLabelText('Undo');
  const redo = () => screen.getByLabelText('Redo');

  it('steps the region, never the map', () => {
    const state = makeState();
    const executor = createExecutor(state, createDefaultRegistry());
    executor.execute({ type: CommandType.PaintTerrain, cells: [{ x: 5, y: 5 }], terrainType: TerrainType.Mountain, elevation: 1 });
    const built = () => state.cells[5]![5]!.terrain?.type;
    expect(built(), 'the map has an edit to undo').toBe(TerrainType.Mountain);
    const painted = [{ x: 2, y: 3 }];
    useEditorStore.setState({
      gridState: state, selectingRegion: true, commandExecutor: executor, region: painted, regionUndoLane: [[]], regionRedoLane: [],
    });
    mount();
    expect(redo()).toHaveProperty('disabled', true);
    fireEvent.click(undo());
    expect(useEditorStore.getState().region).toEqual([]);
    expect(built(), 'the map kept its edit').toBe(TerrainType.Mountain);
    fireEvent.click(redo());
    expect(useEditorStore.getState().region).toEqual(painted);
    useEditorStore.setState({ selectingRegion: false, commandExecutor: null, gridState: null, region: [], regionUndoLane: [], regionRedoLane: [] });
  });
});
