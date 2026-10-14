/*
 * Which camera verb a gesture asks for.
 *
 * Written against capabilities rather than views, so a surface declares what its camera can do and
 * gets the same answer the editor gets. The mapping is stable knowledge about the app's navigation,
 * which is why it is data here rather than a chain of conditionals at the call site.
 */

/** What a camera can do. The wheel zooms on every camera; panning stays on drags and the pan keys. */
export interface CameraCaps {
  /** The camera can orbit: a spatial view. */
  canOrbit: boolean;
}

type NavVerb = 'orbit' | 'pan';

/** A right or middle drag. */
export function navDragVerb(caps: CameraCaps): NavVerb {
  return caps.canOrbit ? 'orbit' : 'pan';
}

/** How a wheel event was classified: a sideways scroll, a touchpad two-finger scroll, or the
 *  discrete notch of a mouse wheel. */
type WheelKind = 'horizontal' | 'scroll' | 'notch';

type WheelVerb = 'yaw' | 'zoom-smooth' | 'zoom-step';

export function wheelVerb(kind: WheelKind, caps: CameraCaps): WheelVerb {
  if (kind === 'horizontal') return caps.canOrbit ? 'yaw' : 'zoom-smooth';
  if (kind === 'scroll') return 'zoom-smooth';
  return 'zoom-step';
}
