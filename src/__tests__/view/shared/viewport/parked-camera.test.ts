/** A parked camera waits on its own map, and each view takes only its own pose, once. */
import { describe, it, expect } from 'vitest';
import { parkCamera, parkCameras, takeParkedCamera, takeParkedCameras } from '../../../../view/shared/viewport/parked-camera';
import { makeState } from '../../../_support/map-state';

const view2d = { x: 4, y: 5, zoom: 2 };
const view3d = { az: 1, el: 2, dist: 3 };

describe('parked cameras', () => {
  it('hands each view its own pose once, leaving the other', () => {
    const map = makeState();
    parkCameras(map, { view2d, view3d });
    expect(takeParkedCamera(map, 'view2d')).toEqual(view2d);
    expect(takeParkedCamera(map, 'view2d')).toBeNull();
    expect(takeParkedCamera(map, 'view3d')).toEqual(view3d);
    expect(takeParkedCameras(map)).toBeNull();
  });

  it('never hands a pose to another map', () => {
    const a = makeState();
    const b = makeState();
    parkCamera(a, 'view3d', view3d);
    expect(takeParkedCamera(b, 'view3d')).toBeNull();
    expect(takeParkedCamera(a, 'view3d')).toEqual(view3d);
  });

  it('merges one pose into what waits, and a replace clears the rest', () => {
    const map = makeState();
    parkCameras(map, { view2d });
    parkCamera(map, 'view3d', view3d);
    expect(takeParkedCameras(map)).toEqual({ view2d, view3d });
    parkCameras(map, { view2d });
    parkCameras(map, null);
    expect(takeParkedCameras(map)).toBeNull();
  });
});
