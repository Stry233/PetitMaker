/**
 * Registers the 3D twin of PixiCanvas's `__petitGetCamera`/`__petitSetCamera` bridge (see
 * canvas/map2d/interaction/window-bridge-register.ts) — the camera round-trip io/autosave uses to
 * persist and restore the 3D orbit camera. Owned by Editor3DCanvas, which holds the ThreeScene
 * across activation toggles (paused, not disposed, while hidden) and rebuilds it on a new
 * GridState identity, so both refs are read live rather than captured once.
 *
 * The GET side only reports a camera when `builtFor` still matches the CURRENT gridState — a
 * scene left over from a previously loaded map has a pose, but it isn't a fact about the map now
 * showing, so reporting it would persist a camera that belongs to nothing.
 *
 * The SET side (io/autosave's restore, applied from App.tsx once loadMap's new GridState has
 * committed) either applies straight to a live matching scene, or — the common case, since the 3D
 * editor is lazy and the matching scene may not exist yet — parks the angle in pending-camera for
 * the scene's next construction to pick up.
 */
import type { RefObject } from 'react';
import type { GridState } from '../../../core/model/types';
import { petitWindow } from '../../../core/runtime/window-bridge';
import { useEditorStore } from '../../../state/store';
import type { ThreeScene } from '../scene/scene';
import { setPendingCameraAngle } from '../scene/pending-camera';

export function registerWindowBridge3D(
  sceneRef: RefObject<ThreeScene | null>,
  builtFor: RefObject<GridState | null>,
): () => void {
  const win = petitWindow();

  const liveMatchingScene = (): ThreeScene | null => {
    const scene = sceneRef.current;
    if (!scene || builtFor.current !== useEditorStore.getState().gridState) return null;
    return scene;
  };

  win.__petitGet3DCamera = () => liveMatchingScene()?.getCurrentAngle();
  win.__petitSet3DCamera = (angle) => {
    const scene = liveMatchingScene();
    if (scene) scene.applyCameraAngle(angle);
    else setPendingCameraAngle(angle);
  };

  return () => {
    delete win.__petitGet3DCamera;
    delete win.__petitSet3DCamera;
  };
}
