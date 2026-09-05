/*
 * Which camera verb a gesture asks for.
 *
 * Written against CAPABILITIES rather than views, so a surface declares what its camera can do and
 * gets the same answer the editor gets. The mapping is stable knowledge about the app's navigation,
 * which is why it is data here rather than a chain of conditionals at the call site.
 */

export interface CameraCaps {
  /** The camera can orbit: a spatial view. */
  canOrbit: boolean;
  /** A wheel or touchpad scroll should ZOOM rather than pan. Both map views ask for this: the wheel
   *  is the zoom control everywhere, and panning stays on drags and the pan keys. */
  wheelZooms: boolean;
}

export type NavVerb = 'orbit' | 'pan';

/** A right or middle drag. */
export function navDragVerb(caps: CameraCaps): NavVerb {
  return caps.canOrbit ? 'orbit' : 'pan';
}

/** How a wheel event was classified: a sideways scroll, a touchpad two-finger scroll, or the
 *  discrete notch of a mouse wheel. */
export type WheelKind = 'horizontal' | 'scroll' | 'notch';

export type WheelVerb = 'yaw' | 'pan' | 'zoom-smooth' | 'zoom-step';

export function wheelVerb(kind: WheelKind, caps: CameraCaps): WheelVerb {
  if (kind === 'horizontal') {
    if (caps.canOrbit && caps.wheelZooms) return 'yaw';
    return caps.wheelZooms ? 'zoom-smooth' : 'pan';
  }
  if (kind === 'scroll') return caps.wheelZooms ? 'zoom-smooth' : 'pan';
  return 'zoom-step';
}
