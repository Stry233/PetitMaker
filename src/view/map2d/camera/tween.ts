import { isMotionReduced } from '../../../platform/channels/motion-state';
import { easeOutCubic, animConfig } from '../../shared/motion/anim-config';
import { timedBeat, type PlayBeat } from '../../shared/viewport/frame-loop';
import { withinOneTurn, type View2dPose, type Viewport } from './viewport';

/** What a glide drives: the viewport it moves, the transform that draws each step and the frame
 *  loop that plays it. */
export interface CameraHost {
  readonly viewport: Pick<Viewport, 'getView' | 'setView'>;
  applyViewportTransform(): void;
  readonly play: PlayBeat;
}

/** The pose `e` of the way from `a` to `b`, turning the short way round; `b` itself at the end. */
const lerpView = (a: View2dPose, b: View2dPose, e: number): View2dPose => {
  if (e >= 1) return b;
  const turn = withinOneTurn(b.heading - a.heading);
  return {
    zoom: a.zoom + (b.zoom - a.zoom) * e,
    offsetX: a.offsetX + (b.offsetX - a.offsetX) * e,
    offsetY: a.offsetY + (b.offsetY - a.offsetY) * e,
    heading: a.heading + turn * e,
  };
};

/**
 * Mutable cell holding the single in-flight camera tween's cancel fn, so a new
 * camera animation can cancel the previous one and the unmount can cancel any
 * pending one.
 */
export type CameraTweenHandle = { cancel: (() => void) | null };

/**
 * Ease `renderer`'s camera toward a destination view. `toTarget` applies the change to the
 * renderer; the resulting view is read back, the camera rewound to the start, and zoom, offset and
 * heading tween together on an ease-out cubic beat on the renderer's frame loop. Reduced motion snaps.
 * The in-flight cancel is stored on `handle`, which the renderer owns, so the next glide and the
 * renderer's teardown cancel it.
 */
export function animateCamera<H extends CameraHost>(
  renderer: H,
  handle: CameraTweenHandle,
  toTarget: (r: H) => void,
): void {
  const from = renderer.viewport.getView();
  toTarget(renderer);
  const target = renderer.viewport.getView();
  if (isMotionReduced()) { renderer.applyViewportTransform(); return; }
  renderer.viewport.setView(from);
  handle.cancel?.();
  handle.cancel = renderer.play(timedBeat(animConfig.cameraGlide.map2dMs, (t) => {
    renderer.viewport.setView(lerpView(from, target, easeOutCubic(t)));
    renderer.applyViewportTransform();
  }));
}
