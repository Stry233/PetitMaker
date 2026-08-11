/**
 * The live 3D scene's camera, for the round-trip io/autosave uses to persist and restore the 3D
 * orbit camera — the twin of `../../map2d/renderer-registry.ts`. Editor3DCanvas reports the scene
 * here whenever it (re)builds or disposes one (mirroring how PixiCanvas reports its renderer).
 *
 * GET only reports a camera when the registered scene was built for the CURRENT `gridState` — a
 * scene left over from a previously loaded map has a pose, but it isn't a fact about the map now
 * showing, so reporting it would persist a camera that belongs to nothing.
 *
 * SET either applies straight to a live matching scene, or — the common case, since the 3D editor
 * is lazy and the matching scene may not exist yet — parks the angle in pending-camera for the
 * scene's next construction to pick up.
 */
import type { GridState } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import type { CameraAngle } from '../capture';
import type { ThreeScene } from './scene';
import { setPendingCameraAngle } from './pending-camera';

let scene: ThreeScene | null = null;
let builtFor: GridState | null = null;

/** Register the live scene + the map it was built for (null clears both, on dispose). */
export function setScene3D(next: ThreeScene | null, forState: GridState | null): void {
  scene = next;
  builtFor = forState;
}

function liveMatchingScene(): ThreeScene | null {
  if (!scene || builtFor !== useEditorStore.getState().gridState) return null;
  return scene;
}

export function get3DCamera(): CameraAngle | undefined {
  return liveMatchingScene()?.getCurrentAngle();
}

export function set3DCamera(angle: CameraAngle): void {
  const s = liveMatchingScene();
  if (s) s.applyCameraAngle(angle);
  else setPendingCameraAngle(angle);
}
