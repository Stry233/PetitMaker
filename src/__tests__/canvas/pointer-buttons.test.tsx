/**
 * Mouse-button routing in the shared pointer machine. LEFT drives the tool (and
 * selection); MIDDLE and RIGHT are interchangeable navigation buttons, so a mouse
 * whose right button is awkward to drag still reaches the camera. Each is checked
 * against a view that can orbit (the 3D editor) and one that cannot (2D, where the
 * same gesture pans).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { makeState } from '../rules/_helpers';

function makeView(canOrbit: boolean) {
  const camera = {
    pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn(),
    ...(canOrbit ? { orbit: vi.fn() } : {}),
  };
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
  };
  const view = {
    projection: {
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay, camera, applyCameraTransform: vi.fn(),
  } as unknown as ActiveView;
  return { view, camera, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. */
function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

function mount(): HTMLElement {
  const { getByTestId } = render(<Host />);
  return getByTestId('canvas');
}

/** Press `button`, drag by (dx, dy) past the 3px threshold, release. */
function dragWith(el: HTMLElement, button: number, dx: number, dy: number): void {
  el.dispatchEvent(pointer('pointerdown', { button, buttons: button === 1 ? 4 : 2, clientX: 100, clientY: 100 }));
  window.dispatchEvent(pointer('pointermove', { button, clientX: 100 + dx, clientY: 100 + dy }));
  window.dispatchEvent(pointer('pointerup', { button, clientX: 100 + dx, clientY: 100 + dy }));
}

const MIDDLE = 1, RIGHT = 2;

describe('pointer machine: middle button navigates like right', () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTool: ToolType.Hand, gridState: makeState(20, 20),
      selectedItemId: null, contextMenu: null, selection: [],
    });
  });
  afterEach(() => { cleanup(); setActiveView(null); });

  it.each([['middle', MIDDLE], ['right', RIGHT]] as const)('%s-drag orbits a view that can orbit', (_name, button) => {
    const { view, camera } = makeView(true);
    setActiveView(view);
    dragWith(mount(), button, 30, 12);

    expect(camera.orbit).toHaveBeenCalledWith(30, 12);
    expect(camera.pan).not.toHaveBeenCalled();
  });

  it.each([['middle', MIDDLE], ['right', RIGHT]] as const)('%s-drag pans a view that cannot orbit', (_name, button) => {
    const { view, camera } = makeView(false);
    setActiveView(view);
    dragWith(mount(), button, 30, 12);

    expect(camera.pan).toHaveBeenCalledWith(-30, -12);
  });

  it.each([['middle', MIDDLE], ['right', RIGHT]] as const)('%s-tap opens the context menu', (_name, button) => {
    const { view } = makeView(true);
    setActiveView(view);
    const el = mount();
    el.dispatchEvent(pointer('pointerdown', { button, clientX: 55, clientY: 35 }));
    window.dispatchEvent(pointer('pointerup', { button, clientX: 55, clientY: 35 }));

    const menu = useEditorStore.getState().contextMenu;
    expect(menu).toMatchObject({ x: 55, y: 35, target: { kind: 'terrain', x: 5, y: 3 } });
  });

  it('a drag past the threshold is navigation, not a context menu', () => {
    const { view } = makeView(true);
    setActiveView(view);
    dragWith(mount(), MIDDLE, 40, 0);

    expect(useEditorStore.getState().contextMenu).toBeNull();
  });

  it('leaves the left button on the tool, not the camera', () => {
    const { view, camera } = makeView(true);
    setActiveView(view);
    dragWith(mount(), 0, 30, 12);

    expect(camera.orbit).not.toHaveBeenCalled();
  });
});
