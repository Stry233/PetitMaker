// @vitest-environment jsdom
/**
 * Ctrl+wheel and trackpad pinch zoom the active view once per event, however many map views have
 * mounted a pointer machine: both canvases stay mounted, and the window listener has one owner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../../view/interaction/use-pointer-interaction';
import { setActiveView } from '../../../../view/active-view';
import { mapHostAttr } from '../../../../view/interaction/map-wheel';
import type { ActiveView } from '../../../../tools/pointer/runtime';

function Host({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid={id} {...mapHostAttr} />;
}

function fakeView() {
  const camera = { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn(), zoomStepAnimated: vi.fn(), fitToMap: vi.fn() };
  return { camera, view: { camera, overlay: {}, projection: {} } as unknown as ActiveView };
}

/** A pinch over the 2D view's host. */
function pinch(): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, bubbles: true, cancelable: true });
  screen.getByTestId('2d').dispatchEvent(event);
  return event;
}

afterEach(() => setActiveView(null));

describe('window ctrl+wheel zoom', () => {
  it('zooms the active camera once with both views mounted', () => {
    const { camera, view } = fakeView();
    setActiveView(view);
    render(<><Host id="2d" /><Host id="3d" /></>);
    expect(pinch().defaultPrevented).toBe(true);
    expect(camera.zoomBy).toHaveBeenCalledTimes(1);
  });

  it('follows the active view and keeps zooming after one of the views unmounts', () => {
    const first = fakeView();
    const second = fakeView();
    setActiveView(first.view);
    const { rerender } = render(<><Host id="2d" /><Host id="3d" /></>);
    setActiveView(second.view);
    rerender(<Host id="2d" />);
    pinch();
    expect(first.camera.zoomBy).not.toHaveBeenCalled();
    expect(second.camera.zoomBy).toHaveBeenCalledTimes(1);
  });
});
