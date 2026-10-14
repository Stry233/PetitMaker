/**
 * The live 3D scene, registered by `Editor3DCanvas` as `map2d/scene/renderer-registry.ts` holds the
 * 2D renderer, and its camera for the save round trip. A camera is reported only from a scene built
 * for the current map, since a leftover scene's pose belongs to no map now showing. Setting a
 * camera poses a matching live scene, or parks the angle (`shared/viewport/parked-camera.ts`) for
 * the next scene built for the current map.
 */
import type { GridState } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import type { CameraAngle } from '../../../state/view-camera';
import type { MapRenderer3D } from './map-renderer';
import { parkCamera } from '../../shared/viewport/parked-camera';

let scene: MapRenderer3D | null = null;
let builtFor: GridState | null = null;

/** Register the live scene + the map it was built for (null clears both, on dispose). */
export function setMapRenderer3D(next: MapRenderer3D | null, forState: GridState | null): void {
  scene = next;
  builtFor = forState;
}

function liveMatchingScene(): MapRenderer3D | null {
  if (!scene || builtFor !== useEditorStore.getState().gridState) return null;
  return scene;
}

export function get3DCamera(): CameraAngle | undefined {
  return liveMatchingScene()?.getCurrentAngle();
}

export function set3DCamera(angle: CameraAngle): void {
  const s = liveMatchingScene();
  if (s) { s.applyCameraAngle(angle); return; }
  const state = useEditorStore.getState().gridState;
  if (state) parkCamera(state, 'view3d', angle);
}
