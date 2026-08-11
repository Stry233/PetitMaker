/**
 * `camera.zoom_in`/`camera.zoom_out` (the keyboard shortcuts) must produce the exact same camera
 * motion as the rail's zoom buttons (`host.camera.zoomIn`/`zoomOut`) — both are the same verb,
 * so a flat 2D camera eases through the tween either way rather than jumping when no view-level
 * `zoomStepAnimated` is available.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setActiveView } from '../../canvas/active-view';
import { setMapRenderer } from '../../canvas/map2d/renderer-registry';
import type { MapRenderer } from '../../canvas/map2d/map-renderer';
import { useEditorStore } from '../../state/store';
import { RUN } from '../../kit/commands';
import type { ActiveView, ViewCamera } from '../../canvas/view-projection';

function fakeCamera(over: Partial<ViewCamera> = {}): ViewCamera {
  return { pan: () => {}, zoomStep: vi.fn(), zoomBy: vi.fn(), ...over } as unknown as ViewCamera;
}

function fakeView(over: Partial<ActiveView> = {}): ActiveView {
  return {
    projection: {
      screenToMacro: () => ({ x: 0, y: 0 }),
      screenToMicro: () => ({ x: 0, y: 0 }),
      cellToScreen: () => ({ x: 0, y: 0, scale: 1 }),
      pan: () => {},
    },
    overlay: {
      showGhost: () => {}, showGhostSpans: () => {}, clearGhost: () => {},
      showSelection: () => {}, clearSelection: () => {},
      showHover: () => {}, clearHover: () => {},
      flashCommit: vi.fn(), showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
      showBand: () => {}, clearBand: () => {},
    },
    applyCameraTransform: () => {},
    camera: fakeCamera(),
    ...over,
  } as unknown as ActiveView;
}

function fakeRenderer(): MapRenderer {
  let view = { zoom: 1, offsetX: 0, offsetY: 0 };
  const viewport = {
    getView: () => view,
    getZoom: () => view.zoom,
    setZoom: vi.fn((z: number) => { view = { ...view, zoom: z }; }),
    setView: vi.fn((v: typeof view) => { view = v; }),
    fitToMap: vi.fn(),
  };
  return {
    viewport,
    objectLayer: { animateRotation: vi.fn() },
    applyViewportTransform: vi.fn(),
    captureMapImage: vi.fn(),
    resyncObjects: vi.fn(),
  } as unknown as MapRenderer;
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
    RUN['camera.zoom_in']!(ctx);
    RUN['camera.zoom_out']!(ctx);
    expect(zoomStepAnimated).toHaveBeenNthCalledWith(1, 1);
    expect(zoomStepAnimated).toHaveBeenNthCalledWith(2, -1);
  });

  it("eases through the 2D tween when no view-level animated step exists, never the raw stepped zoomStep", () => {
    const renderer = fakeRenderer();
    setMapRenderer(renderer);
    const zoomStep = vi.fn();
    setActiveView(fakeView({ camera: fakeCamera({ zoomStep }) }));
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    RUN['camera.zoom_in']!(ctx);
    expect(renderer.viewport.setZoom).toHaveBeenCalledWith(1.25, cx, cy);
    expect(zoomStep).not.toHaveBeenCalled();

    RUN['camera.zoom_out']!(ctx);
    expect(renderer.viewport.setZoom).toHaveBeenCalledWith(0.8, cx, cy);
    expect(zoomStep).not.toHaveBeenCalled();
  });
});
