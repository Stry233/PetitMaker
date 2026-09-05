/**
 * Which camera verb a gesture asks for. The 2D map and the 3D editor answer the same gesture
 * differently, and this is the one place that difference is written down.
 */
import { describe, it, expect } from 'vitest';
import { navDragVerb, wheelVerb } from '../../core/interaction/camera-verbs';

const FLAT = { canOrbit: false, wheelZooms: true };    // the 2D map
const SPATIAL = { canOrbit: true, wheelZooms: true };  // the 3D editor
const NO_ZOOM = { canOrbit: false, wheelZooms: false }; // a surface that keeps the wheel on pan

describe('navDragVerb', () => {
  it('orbits where the view can, and pans where it cannot', () => {
    expect(navDragVerb(SPATIAL)).toBe('orbit');
    expect(navDragVerb(FLAT)).toBe('pan');
  });
});

describe('wheelVerb', () => {
  it('yaws a sideways scroll in 3D and zooms it in 2D', () => {
    expect(wheelVerb('horizontal', SPATIAL)).toBe('yaw');
    expect(wheelVerb('horizontal', FLAT)).toBe('zoom-smooth');
    expect(wheelVerb('horizontal', NO_ZOOM)).toBe('pan');
  });

  it('zooms a touchpad scroll in both map views, and pans it only where the surface opts out', () => {
    expect(wheelVerb('scroll', SPATIAL)).toBe('zoom-smooth');
    expect(wheelVerb('scroll', FLAT)).toBe('zoom-smooth');
    expect(wheelVerb('scroll', NO_ZOOM)).toBe('pan');
  });

  it('keeps a mouse notch on stepped zoom in both views', () => {
    expect(wheelVerb('notch', SPATIAL)).toBe('zoom-step');
    expect(wheelVerb('notch', FLAT)).toBe('zoom-step');
  });
});
