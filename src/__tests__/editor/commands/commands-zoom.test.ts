// @vitest-environment jsdom
/**
 * `camera.zoom_in`/`camera.zoom_out` (the keyboard shortcuts) must produce the exact same camera
 * motion as the rail's zoom buttons (`host.camera.zoomIn`/`zoomOut`): both are the view's eased
 * step, never the raw wheel notch.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setActiveView } from '../../../view/active-view';
import { setMapRenderer } from '../../../view/map2d/scene/renderer-registry';
import { useEditorStore } from '../../../state/store';
import { RUN } from '../../../editor/commands/commands';
import type { ActiveView, ViewCamera } from '../../../tools/pointer/runtime';

function fakeCamera(over: Partial<ViewCamera> = {}): ViewCamera {
  return { pan: () => {}, zoomStep: vi.fn(), zoomBy: vi.fn(), ...over } as unknown as ViewCamera;
}

function fakeView(over: Partial<ActiveView> = {}): ActiveView {
  return {
    projection: {
      screenToPoint: () => ({ x: 0, y: 0 }),
      cellToScreen: () => ({ x: 0, y: 0, scale: 1 }),
    },
    overlay: {
      showGhost: () => {}, showGhostSpans: () => {}, clearGhost: () => {},
      showSelection: () => {}, clearSelection: () => {},
      showHover: () => {}, clearHover: () => {},
      flashCommit: vi.fn(), showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
      showBand: () => {}, clearBand: () => {},
    },
    camera: fakeCamera(),
    ...over,
  } as unknown as ActiveView;
}

const ctx = {} as never;

afterEach(() => {
  setActiveView(null);
  setMapRenderer(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null });
});

describe('camera.zoom_in / camera.zoom_out route through host, same as the zoom buttons', () => {
  it("prefers the view's own eased step, exactly like host.camera.zoomIn/zoomOut", () => {
    const zoomStepAnimated = vi.fn();
    setActiveView(fakeView({ camera: fakeCamera({ zoomStepAnimated }) }));
    RUN['camera.zoom_in'](ctx);
    RUN['camera.zoom_out'](ctx);
    expect(zoomStepAnimated).toHaveBeenNthCalledWith(1, 1);
    expect(zoomStepAnimated).toHaveBeenNthCalledWith(2, -1);
  });
});
