// @vitest-environment jsdom
/** The 2D camera answers the turn verbs the 3D camera answers, through the shared gesture mapping. */
import { describe, it, expect } from 'vitest';
import { Viewport } from '../../../../view/map2d/camera/viewport';
import { camera2d } from '../../../../view/map2d/camera/camera-2d';
import type { CameraTweenHandle } from '../../../../view/map2d/camera/tween';
import { TURN_RAD_PER_PX, TURN_STEP_PX } from '../../../../view/shared/viewport/view-constants';
import { createCameraGestures } from '../../../../view/interaction/camera-gestures';
import { beatClock } from '../../../_support/beat-clock';

const W = 800, H = 600;

function setUp() {
  const viewport = new Viewport(W, H);
  viewport.fitToMap(40, 30);
  let applied = 0;
  const glide: CameraTweenHandle = { cancel: null };
  const loop = beatClock();
  const camera = camera2d({ viewport, applyViewportTransform: () => { applied++; }, play: loop.play, mapSize: () => ({ width: 40, height: 30 }) }, glide);
  let now = 0;
  /** Runs the frame loop until every glide in flight has landed. */
  const glideOut = (): void => { loop.frame(now); now += 2000; loop.frame(now); };
  return { viewport, camera, applied: () => applied, glideOut };
}

const centre = (vp: Viewport) => vp.screenToPoint(W / 2, H / 2);
const ptr = (button: number, x: number, y = 300): PointerEvent =>
  ({ button, clientX: x, clientY: y, pointerType: 'mouse', preventDefault: () => {} }) as PointerEvent;

describe('the 2D camera turns', () => {
  it('turns by the 3D rate for a drag, ignoring the vertical travel', () => {
    const { viewport, camera, applied } = setUp();
    const zoom = viewport.getZoom(), at = centre(viewport);
    camera.orbit!(100, 40);
    expect(viewport.getHeading()).toBeCloseTo(100 * TURN_RAD_PER_PX, 12);
    expect(viewport.getZoom()).toBe(zoom);
    expect(centre(viewport).x).toBeCloseTo(at.x, 9);
    expect(centre(viewport).y).toBeCloseTo(at.y, 9);
    expect(applied()).toBeGreaterThan(0);
  });

  it('turns the map with the fingers for a two-finger twist', () => {
    const { viewport, camera } = setUp();
    const c = centre(viewport);
    camera.orbitTwist!(0.3);
    expect(viewport.cellToScreen(c.x + 2, c.y).y).toBeLessThan(H / 2);
  });

  it('turns on a right drag and a middle drag rather than panning', () => {
    for (const button of [2, 1]) {
      const { viewport, camera } = setUp();
      const offset = viewport.getOffset();
      const g = createCameraGestures({ camera: () => camera });
      g.navDown(ptr(button, 100));
      g.navMove(ptr(button, 160));
      g.navUp();
      expect(viewport.getHeading()).toBeCloseTo(60 * TURN_RAD_PER_PX, 12);
      expect(viewport.getOffset()).toEqual(offset);
    }
  });

  it('turns on a sideways wheel', () => {
    const { viewport, camera } = setUp();
    const g = createCameraGestures({ camera: () => camera });
    g.wheel({ deltaX: 50, deltaY: 0, deltaMode: 0, ctrlKey: false, clientX: 10, clientY: 20, preventDefault: () => {} } as WheelEvent);
    expect(viewport.getHeading()).toBeCloseTo(50 * TURN_RAD_PER_PX, 12);
  });

  it('glides one turn step for a turn button, as the zoom buttons glide', () => {
    const { viewport, camera, glideOut } = setUp();
    camera.turnStep!(-1);
    expect(viewport.getHeading()).toBe(0);
    glideOut();
    expect(viewport.getHeading()).toBeCloseTo(-TURN_STEP_PX * TURN_RAD_PER_PX, 12);
  });
});

const QUARTER = Math.PI / 2;
const DEG = Math.PI / 180;
/** The drag px that turn the 2D view by `rad`. */
const px = (rad: number): number => rad / TURN_RAD_PER_PX;

describe('the 2D camera settles on a quarter turn', () => {
  it('[UI-67] holds a quarter turn while the hand stays within a few degrees of it, and lets go past them', () => {
    const { viewport, camera } = setUp();
    camera.orbit!(px(3 * DEG), 0);
    expect(viewport.getHeading()).toBe(0);
    camera.orbit!(px(6 * DEG), 0);
    expect(viewport.getHeading()).toBeCloseTo(9 * DEG, 12);
    camera.orbit!(px(78 * DEG), 0);
    expect(viewport.getHeading()).toBeCloseTo(QUARTER, 12);
    camera.orbitTwist!(-2 * DEG);
    expect(viewport.getHeading()).toBeCloseTo(QUARTER, 12);
  });

  it('[UI-67] lands the turn buttons on a quarter turn they step near', () => {
    const { viewport, camera, glideOut } = setUp();
    for (let i = 0; i < 5; i++) { camera.turnStep!(1); glideOut(); }
    expect(viewport.getHeading()).toBeCloseTo(QUARTER, 12);
  });

  it('[UI-67] takes up from wherever Fit view or a restored pose left the view', () => {
    const { viewport, camera } = setUp();
    camera.orbit!(px(40 * DEG), 0);
    viewport.setView({ ...viewport.getView(), heading: 0 });
    camera.orbit!(px(2 * DEG), 0);
    expect(viewport.getHeading()).toBe(0);
  });
});


