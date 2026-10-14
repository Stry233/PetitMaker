/**
 * Saved cameras waiting for the map they belong to. A restore or the end of a planet session parks
 * the poses for the map it installs, and each view takes its own when it draws that map: the 2D
 * view right after it frames the map, the 3D view when its scene is built for it (the scene is
 * built lazily, so a pose may wait a whole session for it). A pose set while no view can take it
 * waits here too.
 *
 * Keyed weakly by the map, so a scene built for another map never takes a pose, and a pose parked
 * for a map no view drew goes with that map.
 */
import type { GridState } from '../../../core/model/types';
import type { ViewCameras } from '../../../state/view-camera';

const parked = new WeakMap<GridState, ViewCameras>();

/** Parks `cameras` for `state`, replacing whatever waited there; null clears it. */
export function parkCameras(state: GridState, cameras: ViewCameras | null): void {
  if (cameras) parked.set(state, { ...cameras });
  else parked.delete(state);
}

/** Parks one view's pose for `state`, leaving the other view's. */
export function parkCamera<K extends keyof ViewCameras>(state: GridState, view: K, pose: NonNullable<ViewCameras[K]>): void {
  parked.set(state, { ...parked.get(state), [view]: pose });
}

/** Takes one view's pose parked for `state`, once. */
export function takeParkedCamera<K extends keyof ViewCameras>(state: GridState, view: K): ViewCameras[K] | null {
  const cameras = parked.get(state);
  const pose = cameras?.[view] ?? null;
  if (cameras && pose) {
    const rest = { ...cameras };
    delete rest[view];
    if (rest.view2d || rest.view3d) parked.set(state, rest); else parked.delete(state);
  }
  return pose;
}

/** Takes everything parked for `state`, once. */
export function takeParkedCameras(state: GridState): ViewCameras | null {
  const cameras = parked.get(state) ?? null;
  parked.delete(state);
  return cameras;
}
