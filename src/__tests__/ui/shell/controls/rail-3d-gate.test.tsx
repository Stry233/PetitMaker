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

const gl = vi.hoisted(() => ({ webgl2: true }));
vi.mock('../../../../platform/device/device-quality', async (orig) => ({
  ...(await orig<object>()),
  hasWebGL2: () => gl.webgl2,
}));

const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('../../../../platform/channels/toast-bus', async (orig) => ({ ...(await orig<object>()), showToast: (...args: unknown[]) => toast.show(...args) }));

const toggle = () => screen.getByLabelText('Switch view');

beforeEach(() => {
  window.innerHeight = 900;
  toast.show.mockClear();
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, viewMode: '2d', uiZoom: 1,
  });
});
afterEach(() => { cleanup(); gl.webgl2 = true; });

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
    const executor = { undo: vi.fn(), redo: vi.fn() };
    const painted = [{ x: 2, y: 3 }];
    // `INVALID STORE SEED:` an executor that only records whether the map's history was stepped.
    useEditorStore.setState({
      selectingRegion: true, commandExecutor: executor as never, region: painted, regionUndoLane: [[]], regionRedoLane: [],
    });
    mount();
    expect(redo()).toHaveProperty('disabled', true);
    fireEvent.click(undo());
    expect(useEditorStore.getState().region).toEqual([]);
    expect(executor.undo).not.toHaveBeenCalled();
    fireEvent.click(redo());
    expect(useEditorStore.getState().region).toEqual(painted);
    expect(executor.redo).not.toHaveBeenCalled();
    useEditorStore.setState({ selectingRegion: false, commandExecutor: null, region: [], regionUndoLane: [], regionRedoLane: [] });
  });
});
