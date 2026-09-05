/**
 * Every verb on the host resolves against whichever view is showing, or is named 2D-only. A verb
 * that silently did nothing in one view is how the 3D editor lost its removal animation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setActiveView } from '../../canvas/active-view';
import { setMapRenderer } from '../../canvas/map2d/renderer-registry';
import type { MapRenderer } from '../../canvas/map2d/map-renderer';
import { useEditorStore } from '../../state/store';
import { newMap } from '../../kit/operations';
import { host } from '../../kit/host';
import type { ActiveView, ViewCamera } from '../../canvas/view-projection';

function fakeCamera(over: Partial<ViewCamera> = {}): ViewCamera {
  return { pan: () => {}, zoomStep: () => {}, zoomBy: vi.fn(), ...over } as unknown as ViewCamera;
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

/** A renderer stub with a real, mutable viewport (tracks the zoom/offset a call applies) rather
 *  than bare mocks, since the 2D tween path reads its own writes back before rewinding them. */
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
    captureMapImage: vi.fn(() => 'data:image/png;base64,x'),
    captureAnnotationsImage: vi.fn(() => 'data:image/png;base64,ink'),
    resyncObjects: vi.fn(),
  } as unknown as MapRenderer;
}

afterEach(() => {
  setActiveView(null);
  setMapRenderer(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null });
});

describe('host', () => {
  it('does nothing rather than throwing when no view is showing', () => {
    expect(() => { host.feedback.flash([{ x: 1, y: 1 }]); host.camera.fit(); host.feedback.poof('x'); }).not.toThrow();
  });

  it('flashes through the live view', () => {
    const view = fakeView();
    setActiveView(view);
    host.feedback.flash([{ x: 2, y: 3 }], { terrainMode: true });
    expect(view.overlay.flashCommit).toHaveBeenCalledWith([{ x: 2, y: 3 }], { terrainMode: true });
  });

  it('collapses an object through the view that can, in either view', () => {
    const animateRemove = vi.fn();
    setActiveView(fakeView({ animateRemove }));
    host.feedback.poof('h1');
    expect(animateRemove).toHaveBeenCalledWith('h1');
  });

  it('shows and clears the buildable region on the live view', () => {
    const view = fakeView();
    setActiveView(view);
    host.buildableRegion.show([{ x: 0, y: 0 }]);
    host.buildableRegion.clear();
    expect(view.overlay.showBuildableRegion).toHaveBeenCalled();
    expect(view.overlay.clearBuildableRegion).toHaveBeenCalled();
  });

  it('plops through the view when it has its own animation', () => {
    const plopObject = vi.fn();
    setActiveView(fakeView({ plopObject }));
    host.feedback.plop('o1');
    expect(plopObject).toHaveBeenCalledWith('o1');
  });

  it('reports no capture when the 2D renderer is not mounted', () => {
    expect(host.capture2d()).toBeNull();
  });

  it('captures and resyncs through the registered 2D renderer', () => {
    const renderer = fakeRenderer();
    setMapRenderer(renderer);
    expect(host.capture2d(512, true)).toBe('data:image/png;base64,x');
    expect(renderer.captureMapImage).toHaveBeenCalledWith(512, true, undefined, undefined);
    host.resync();
    expect(renderer.resyncObjects).toHaveBeenCalled();
  });

  it('reports no ink capture when the 2D renderer is not mounted', () => {
    expect(host.capture2dAnnotations()).toBeNull();
  });

  it('captures the ink layer alone through the registered 2D renderer', () => {
    const renderer = fakeRenderer();
    setMapRenderer(renderer);
    expect(host.capture2dAnnotations(2048)).toBe('data:image/png;base64,ink');
    expect(renderer.captureAnnotationsImage).toHaveBeenCalledWith(2048);
  });

  it('reports no 2D camera when nothing is mounted', () => {
    expect(host.camera.get2d()).toBeUndefined();
  });

  it('round-trips the 2D camera through the registered renderer', () => {
    const renderer = fakeRenderer();
    setMapRenderer(renderer);
    host.camera.set2d({ x: 10, y: 20, zoom: 2 });
    expect(renderer.viewport.setView).toHaveBeenCalledWith({ zoom: 2, offsetX: 10, offsetY: 20 });
    expect(renderer.applyViewportTransform).toHaveBeenCalled();
    expect(host.camera.get2d()).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  describe('spin', () => {
    it("rotates through the view's animateRotation", () => {
      const animateRotation = vi.fn();
      setActiveView(fakeView({ animateRotation }));
      host.feedback.spin('o1', 0, 90);
      expect(animateRotation).toHaveBeenCalledWith('o1', 0, 90, expect.any(Function));
    });

    it('is a no-op when no view is registered', () => {
      expect(() => host.feedback.spin('o1', 0, 90)).not.toThrow();
    });
  });

  describe('zoom', () => {
    it("prefers the view's own eased step when present", () => {
      const zoomStepAnimated = vi.fn();
      setActiveView(fakeView({ camera: fakeCamera({ zoomStepAnimated }) }));
      host.camera.zoomIn();
      host.camera.zoomOut();
      expect(zoomStepAnimated).toHaveBeenNthCalledWith(1, 1);
      expect(zoomStepAnimated).toHaveBeenNthCalledWith(2, -1);
    });

    it("falls back to an orbit camera's zoomBy, anchored at screen centre", () => {
      const zoomBy = vi.fn();
      setActiveView(fakeView({ camera: fakeCamera({ zoomBy, orbit: () => {} }) }));
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      host.camera.zoomIn();
      expect(zoomBy).toHaveBeenCalledWith(1.25, cx, cy);
      host.camera.zoomOut();
      expect(zoomBy).toHaveBeenCalledWith(0.8, cx, cy);
    });

    it('falls back to the 2D tween when neither is available', () => {
      const renderer = fakeRenderer();
      setMapRenderer(renderer);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      host.camera.zoomIn();
      expect(renderer.viewport.setZoom).toHaveBeenCalledWith(1.25, cx, cy);
      host.camera.zoomOut();
      expect(renderer.viewport.setZoom).toHaveBeenCalledWith(0.8, cx, cy);
    });
  });

  describe('fit', () => {
    it("prefers the view's own fitToMap", () => {
      const fitToMap = vi.fn();
      setActiveView(fakeView({ camera: fakeCamera({ fitToMap }) }));
      host.camera.fit();
      expect(fitToMap).toHaveBeenCalled();
    });

    it("falls back to the 2D tween sized from the live map's template when no view fitToMap exists", () => {
      newMap('hexia');
      const { template } = useEditorStore.getState().gridState!;
      const renderer = fakeRenderer();
      setMapRenderer(renderer);
      host.camera.fit();
      expect(renderer.viewport.fitToMap).toHaveBeenCalledWith(template.width, template.height);
    });
  });
});
