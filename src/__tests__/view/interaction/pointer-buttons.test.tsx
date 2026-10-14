// @vitest-environment jsdom
/**
 * Mouse-button routing in the shared pointer machine. Left drives the tool (and
 * selection); `MIDDLE` and `RIGHT` are interchangeable navigation buttons, so a mouse
 * whose right button is awkward to drag still reaches the camera. Each is checked
 * against a view that can orbit (the 3D editor) and one that cannot (2D, where the
 * same gesture pans).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { useCameraOnly } from '../../../view/interaction/use-camera-only';
import { setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { GestureCamera } from '../../../view/interaction/camera-gestures';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { armedEditMode } from '../../_support/store';

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
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay, camera, 
  } as unknown as ActiveView;
  return { view, camera, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

function CameraHost({ camera }: { camera: GestureCamera }) {
  const ref = useRef<HTMLDivElement>(null);
  useCameraOnly(ref, () => camera, true);
  return <div ref={ref} data-testid="camera-preview" />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. */
function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

/** The pan-drag key (Space) has no per-event field the machine reads: it announces itself through
 *  the same global keydown/keyup tracker a real held key would fire. */
function setPanKeyHeld(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { code: 'Space' }));
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
      gridState: makeState(20, 20), contextMenu: null, selection: [],
      ...armedEditMode({ tool: ToolType.Hand, item: null }),
    });
  });
  afterEach(() => { cleanup(); setActiveView(null); });

  it.each(['2d', '3d', 'preview'] as const)('%s releases text focus on a map press and preserves the draft', (surface) => {
    const { view } = makeView(surface !== '2d');
    setActiveView(view);
    const ui = render(<><textarea defaultValue="Keep this draft" />{surface === 'preview' ? <CameraHost camera={view.camera} /> : <Host />}</>);
    const field = ui.getByRole('textbox') as HTMLTextAreaElement;
    const host = ui.getByTestId(surface === 'preview' ? 'camera-preview' : 'canvas');
    field.focus();
    field.select();
    const event = pointer('pointerdown', { button: 0, clientX: 100, clientY: 100 });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(field);
    expect(field.value).toBe('Keep this draft');
    window.dispatchEvent(pointer('pointerup', { button: 0, clientX: 100, clientY: 100 }));
  });

  it('keeps text focus while scrolling the map or selecting inside the field', () => {
    const { view } = makeView(false);
    setActiveView(view);
    const ui = render(<><textarea defaultValue="Keep this draft" /><Host /></>);
    const field = ui.getByRole('textbox') as HTMLTextAreaElement;
    field.focus();
    ui.getByTestId('canvas').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }));
    expect(document.activeElement).toBe(field);
    field.dispatchEvent(pointer('pointerdown', { button: 0 }));
    expect(document.activeElement).toBe(field);
  });

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
    // Map point (5.5, 3.5) lies in terrain cell (6, 4), which covers [5.5, 6.5) × [3.5, 4.5).
    expect(menu).toMatchObject({ x: 55, y: 35, target: { kind: 'terrain', x: 6, y: 4 } });
  });

  it('opens no context menu while the tour is running', () => {
    // The tour is not modal: the app under its dim is fully operable, which is how pressing the
    // real phone advances a step. What is held back is the floating surfaces at z.contextMenu, far
    // above z.tour, which would paint over the walkthrough they interrupted (the store refuses to
    // open either one; see the delete popover's half of this in tour-state).
    useEditorStore.setState({ tourRunning: true });
    try {
      const { view } = makeView(true);
      setActiveView(view);
      const el = mount();
      el.dispatchEvent(pointer('pointerdown', { button: RIGHT, clientX: 55, clientY: 35 }));
      window.dispatchEvent(pointer('pointerup', { button: RIGHT, clientX: 55, clientY: 35 }));

      expect(useEditorStore.getState().contextMenu).toBeNull();
    } finally {
      useEditorStore.setState({ tourRunning: false });
    }
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

  it('pans a left drag while the pan-drag key is held, even over a tool that would otherwise draw', () => {
    useEditorStore.setState({ ...armedEditMode({ tool: ToolType.TerrainBrush }) });
    const { view, camera } = makeView(true);
    setActiveView(view);
    const el = mount();
    setPanKeyHeld(true);
    try {
      el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 100, clientY: 100 }));
      // buttons: 0 here is load-bearing: the pan-drag key pans on any move, with no button guard,
      // while a left-drag pan only applies while (e.buttons & 1) !== 0 — a move reporting no
      // buttons held distinguishes the two, and only passes under the pan-key mapping.
      window.dispatchEvent(pointer('pointermove', { button: 0, buttons: 0, clientX: 130, clientY: 112 }));
      window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 130, clientY: 112 }));
    } finally {
      setPanKeyHeld(false);
    }

    expect(camera.pan).toHaveBeenCalledWith(-30, -12);
    expect(camera.orbit).not.toHaveBeenCalled();
  });
});

/** A touch point: jsdom's MouseEvent with the fields the touch path reads. */
function finger(type: string, id: number, x: number, y: number): MouseEvent {
  const e = pointer(type, { button: 0, buttons: 1, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'pointerId', { value: id });
  return e;
}

describe('camera-only surface: fingers', () => {
  afterEach(cleanup);

  it('slides with one finger and pinches with two, as the editor does', () => {
    const camera = { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() };
    const el = render(<CameraHost camera={camera} />).getByTestId('camera-preview');
    el.dispatchEvent(finger('pointerdown', 1, 100, 100));
    window.dispatchEvent(finger('pointermove', 1, 110, 104));
    expect(camera.pan).toHaveBeenCalled();
    expect(camera.zoomBy).not.toHaveBeenCalled();

    el.dispatchEvent(finger('pointerdown', 2, 200, 100));
    window.dispatchEvent(finger('pointermove', 2, 240, 100));
    expect(camera.zoomBy).toHaveBeenCalled();
    window.dispatchEvent(finger('pointerup', 2, 240, 100));
    window.dispatchEvent(finger('pointerup', 1, 110, 104));
  });
});
