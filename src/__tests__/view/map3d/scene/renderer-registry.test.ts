/**
 * The registry's two rules: a scene built for a map that is no longer live reports no camera
 * (never persists a pose that belongs to nothing), and a set with no live matching scene queues
 * the angle for the current map instead of dropping it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useEditorStore } from '../../../../state/store';
import { newMap } from '../../../../editor/operations';
import { editorPort } from '../../../../editor/session/context';
import { get3DCamera, set3DCamera, setMapRenderer3D } from '../../../../view/map3d/scene/renderer-registry';
import { takeParkedCamera } from '../../../../view/shared/viewport/parked-camera';
import type { MapRenderer3D } from '../../../../view/map3d/scene/map-renderer';
import type { CameraAngle } from '../../../../state/view-camera';

function fakeScene(angle: CameraAngle): MapRenderer3D {
  return { getCurrentAngle: () => angle, applyCameraAngle: vi.fn() } as unknown as MapRenderer3D;
}

afterEach(() => {
  setMapRenderer3D(null, null);
  useEditorStore.setState({ gridState: null, commandExecutor: null });
});

describe('camera-registry', () => {
  it('reports no camera when no scene is registered', () => {
    expect(get3DCamera()).toBeUndefined();
  });

  it("reports the live scene's angle when it was built for the current map", () => {
    newMap(editorPort, 'hexia');
    const angle: CameraAngle = { az: 1, el: 2, dist: 3 };
    setMapRenderer3D(fakeScene(angle), useEditorStore.getState().gridState);
    expect(get3DCamera()).toEqual(angle);
  });

  it('reports no camera for a scene built for a previously loaded map', () => {
    newMap(editorPort, 'hexia');
    setMapRenderer3D(fakeScene({ az: 1, el: 2, dist: 3 }), useEditorStore.getState().gridState);
    newMap(editorPort, 'hexia'); // a fresh GridState identity, as a reload produces
    expect(get3DCamera()).toBeUndefined();
  });

  it('applies straight to a live matching scene', () => {
    newMap(editorPort, 'hexia');
    const scene = fakeScene({ az: 0, el: 0, dist: 1 });
    setMapRenderer3D(scene, useEditorStore.getState().gridState);
    const next: CameraAngle = { az: 5, el: 6, dist: 7 };
    set3DCamera(next);
    expect(scene.applyCameraAngle).toHaveBeenCalledWith(next);
  });

  it('queues the angle for the next construction when no live scene matches', () => {
    newMap(editorPort, 'hexia');
    const stale = fakeScene({ az: 0, el: 0, dist: 1 });
    setMapRenderer3D(stale, useEditorStore.getState().gridState);
    newMap(editorPort, 'hexia'); // stale no longer matches
    const next: CameraAngle = { az: 9, el: 8, dist: 7 };
    set3DCamera(next);
    expect(stale.applyCameraAngle).not.toHaveBeenCalled();
    expect(takeParkedCamera(useEditorStore.getState().gridState!, 'view3d')).toEqual(next);
  });

  it("never hands one map's queued angle to a scene built for another", () => {
    newMap(editorPort, 'hexia');
    const mapA = useEditorStore.getState().gridState!;
    set3DCamera({ az: 9, el: 8, dist: 7 });
    newMap(editorPort, 'hexia'); // map B loads before 3D was ever opened for map A
    const mapB = useEditorStore.getState().gridState!;
    expect(takeParkedCamera(mapB, 'view3d')).toBeNull();
    expect(takeParkedCamera(mapA, 'view3d')).toEqual({ az: 9, el: 8, dist: 7 });
  });
});
