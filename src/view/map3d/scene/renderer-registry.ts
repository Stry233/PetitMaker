/**
 * The live 3D scene, registered by `Editor3DCanvas` as `map2d/scene/renderer-registry.ts` holds the
 * 2D renderer, and its camera for the save round trip. A camera is reported only from a scene built
 * for the map shown (`state/map-stand-in.ts:shownMap`), since a leftover scene's pose belongs to no
 * map now showing. Setting a camera poses a matching live scene, or parks the angle
 * (`shared/viewport/parked-camera.ts`) for the next scene built for the current map.
 */
import type { GridState } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import type { CameraAngle } from '../../../state/view-camera';
import type { ScreenBox } from '../../../tools/pointer/runtime';
import type { SeenView } from '../camera/camera-pose';
import type { MapRenderer3D } from './map-renderer';
import { parkCamera } from '../../shared/viewport/parked-camera';
import { shownMap } from '../../../state/map-stand-in';

let scene: MapRenderer3D | null = null;
let builtFor: GridState | null = null;

/** Register the live scene + the map it was built for (null clears both, on dispose). */
export function setMapRenderer3D(next: MapRenderer3D | null, forState: GridState | null): void {
  scene = next;
  builtFor = forState;
}

function liveMatchingScene(): MapRenderer3D | null {
  if (!scene || builtFor !== shownMap(useEditorStore.getState())) return null;
  return scene;
}

export function get3DCamera(): CameraAngle | undefined {
  return liveMatchingScene()?.getCurrentAngle();
}

/** What the live scene of the map shown shows inside the client box `box` (`MapRenderer3D.seenIn`). */
export function seen3D(box: ScreenBox): SeenView | null {
  return liveMatchingScene()?.seenIn(box) ?? null;
}

export function set3DCamera(angle: CameraAngle): void {
  const s = liveMatchingScene();
  if (s) { s.applyCameraAngle(angle); return; }
  const state = useEditorStore.getState().gridState;
  if (state) parkCamera(state, 'view3d', angle);
}
