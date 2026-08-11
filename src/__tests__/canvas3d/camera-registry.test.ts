/**
 * The registry's two rules: a scene built for a map that is no longer live reports no camera
 * (never persists a pose that belongs to nothing), and a set with no live matching scene queues
 * the angle instead of dropping it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useEditorStore } from '../../state/store';
import { newMap } from '../../kit/operations';
import { get3DCamera, set3DCamera, setScene3D } from '../../canvas/map3d/scene/camera-registry';
import { takePendingCameraAngle } from '../../canvas/map3d/scene/pending-camera';
import type { ThreeScene } from '../../canvas/map3d/scene/scene';
import type { CameraAngle } from '../../canvas/map3d/capture';

function fakeScene(angle: CameraAngle): ThreeScene {
  return { getCurrentAngle: () => angle, applyCameraAngle: vi.fn() } as unknown as ThreeScene;
}

afterEach(() => {
  setScene3D(null, null);
  takePendingCameraAngle(); // drain any angle a test queued, so it can't leak into the next one
  useEditorStore.setState({ gridState: null, commandExecutor: null });
});

describe('camera-registry', () => {
  it('reports no camera when no scene is registered', () => {
    expect(get3DCamera()).toBeUndefined();
  });

  it("reports the live scene's angle when it was built for the current map", () => {
    newMap('hexia');
    const angle: CameraAngle = { az: 1, el: 2, dist: 3 };
    setScene3D(fakeScene(angle), useEditorStore.getState().gridState);
    expect(get3DCamera()).toEqual(angle);
  });

  it('reports no camera for a scene built for a previously loaded map', () => {
    newMap('hexia');
    setScene3D(fakeScene({ az: 1, el: 2, dist: 3 }), useEditorStore.getState().gridState);
    newMap('hexia'); // a fresh GridState identity, as a reload produces
    expect(get3DCamera()).toBeUndefined();
  });

  it('applies straight to a live matching scene', () => {
    newMap('hexia');
    const scene = fakeScene({ az: 0, el: 0, dist: 1 });
    setScene3D(scene, useEditorStore.getState().gridState);
    const next: CameraAngle = { az: 5, el: 6, dist: 7 };
    set3DCamera(next);
    expect(scene.applyCameraAngle).toHaveBeenCalledWith(next);
  });

  it('queues the angle for the next construction when no live scene matches', () => {
    newMap('hexia');
    const stale = fakeScene({ az: 0, el: 0, dist: 1 });
    setScene3D(stale, useEditorStore.getState().gridState);
    newMap('hexia'); // stale no longer matches
    const next: CameraAngle = { az: 9, el: 8, dist: 7 };
    set3DCamera(next);
    expect(stale.applyCameraAngle).not.toHaveBeenCalled();
    expect(takePendingCameraAngle()).toEqual(next);
  });
});
