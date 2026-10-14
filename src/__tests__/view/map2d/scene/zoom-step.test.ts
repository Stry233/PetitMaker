// @vitest-environment jsdom
/** A wheel notch in and a notch out land on the zoom they started from, so a scroll back and forth
 *  never drifts the map's scale. */
import '../../../_support/pixi-env';
import { describe, it, expect, afterEach } from 'vitest';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { setReducedMotion, __resetMotionState } from '../../../../platform/channels/motion-state';
import { makeState } from '../../../_support/map-state';

const renderers: MapRenderer[] = [];

afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
  __resetMotionState();
});

function renderer(): MapRenderer {
  const r = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 400, 300);
  renderers.push(r);
  return r;
}

describe('the 2D wheel notch', () => {
  it('returns to the starting zoom after one notch in and one out', () => {
    const r = renderer();
    const camera = r.asEditorView().camera;
    r.viewport.setZoom(1, 200, 150);
    const start = r.viewport.getZoom();
    camera.zoomStep(1, 200, 150);
    expect(r.viewport.getZoom()).toBeGreaterThan(start);
    camera.zoomStep(-1, 200, 150);
    expect(r.viewport.getZoom()).toBeCloseTo(start, 10);
  });
});

describe('the 2D camera buttons', () => {
  it('step by the button factor about the map box centre, and back', () => {
    setReducedMotion(true); // the glide snaps, so the step lands at once
    const r = renderer();
    const camera = r.asEditorView().camera;
    r.viewport.setZoom(1, 200, 150);
    camera.zoomStepAnimated!(1);
    expect(r.viewport.getZoom()).toBeCloseTo(1.25, 10);
    camera.zoomStepAnimated!(-1);
    expect(r.viewport.getZoom()).toBeCloseTo(1, 10);
  });

  it('keep the world point at the map box centre where the box is off the window centre', () => {
    setReducedMotion(true);
    const r = renderer();
    r.viewport.setOrigin(500, 40); // a dock beside the box pushes it right of the window centre
    r.viewport.setZoom(1, 0, 0);
    const before = r.viewport.worldAtCentre();
    r.asEditorView().camera.zoomStepAnimated!(1);
    const after = r.viewport.worldAtCentre();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('fit the map the renderer shows', () => {
    setReducedMotion(true);
    const r = renderer();
    const state = makeState(24, 16);
    r.initMap(state, false);
    const fitted = renderer();
    fitted.viewport.fitToMap(24, 16);
    r.viewport.setZoom(3, 0, 0);
    r.asEditorView().camera.fitToMap!();
    expect(r.viewport.getView()).toEqual(fitted.viewport.getView());
  });
});
