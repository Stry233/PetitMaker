/**
 * The 2D view's camera verbs (`ViewCamera`), over its viewport. It answers the verbs the 3D camera
 * answers, turning included, so the gesture mapping and the rail drive both views alike; the flat
 * view has no pitch, so a turn drag's vertical travel does nothing here. A turn settles on a quarter
 * turn the hand comes within `QUARTER_HOLD` of, so the map squares up without aiming exactly.
 */
import type { ViewCamera } from '../../../tools/pointer/runtime';
import { TURN_RAD_PER_PX, TURN_STEP_PX, ZOOM_STEP } from '../../shared/viewport/view-constants';
import { animateCamera, type CameraHost, type CameraTweenHandle } from './tween';
import type { Viewport } from './viewport';

/** How near a quarter turn the hand must bring the flat view for it to hold there, in radians. */
const QUARTER_HOLD = 5 * Math.PI / 180;

/** The heading shown for an aimed one: the quarter turn within `QUARTER_HOLD` of it, else itself. */
function settled(aim: number): number {
  const quarter = Math.round(aim / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(aim - quarter) <= QUARTER_HOLD ? quarter : aim;
}

/** What the camera moves and redraws, and the map size Fit view frames. */
interface Camera2dHost extends CameraHost {
  readonly viewport: Viewport;
  /** The map's size in cells, null while no map is installed. */
  mapSize(): { width: number; height: number } | null;
}

/** The verbs over `host`, gliding through `glide`, the host's one in-flight camera glide. */
export function camera2d(host: Camera2dHost, glide: CameraTweenHandle): ViewCamera {
  const { viewport } = host;
  const now = (move: () => void) => { move(); host.applyViewportTransform(); };
  // The heading the hand has asked for, unsettled, and the one shown for it. A heading anything
  // else set (Fit view, a restored pose) is taken up as the new aim.
  let aim = viewport.getHeading(), shown = aim;
  const aimedBy = (dRadians: number): number => {
    if (viewport.getHeading() !== shown) aim = viewport.getHeading();
    aim += dRadians;
    shown = settled(aim);
    return shown;
  };
  return {
    pan: (dx, dy) => now(() => viewport.pan(dx, dy)),
    zoomStep: (dir, ax, ay) => now(() => viewport.setZoom(viewport.getZoom() * ZOOM_STEP.notch.map2d ** dir, ax, ay)),
    // The camera buttons glide about the map box centre, as the 3D camera dollies about its target.
    zoomStepAnimated: (dir) => animateCamera(host, glide, (h) => h.viewport.setZoomAtCentre(h.viewport.getZoom() * ZOOM_STEP.button ** dir)),
    zoomBy: (factor, ax, ay) => now(() => viewport.setZoom(viewport.getZoom() * factor, ax, ay)),
    orbit: (dx) => now(() => viewport.turnTo(aimedBy(dx * TURN_RAD_PER_PX))),
    orbitTwist: (dRadians) => now(() => viewport.turnTo(aimedBy(dRadians))),
    turnStep: (dir) => {
      const to = aimedBy(dir * TURN_STEP_PX * TURN_RAD_PER_PX);
      animateCamera(host, glide, (h) => h.viewport.turnTo(to));
    },
    fitToMap: () => {
      const size = host.mapSize();
      if (size) animateCamera(host, glide, (h) => h.viewport.fitToMap(size.width, size.height));
    },
    fitBox: (box, into) => animateCamera(host, glide, (h) => h.viewport.setView(h.viewport.boxedView(box, into))),
  };
}
