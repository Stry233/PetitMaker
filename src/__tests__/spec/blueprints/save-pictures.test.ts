// @vitest-environment jsdom
/** The save step's pictures are what its viewfinder shows: each view's picture holds the map as the
 *  view drew it inside the viewfinder, turned and seen from where the view was. */
import { afterEach, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { watchFramedThumbs, type FramedPictures } from '../../../editor/editing/blueprint';
import { THUMB_ASPECT } from '../../../io/blueprint/facts';
import { setActiveView } from '../../../view/active-view';
import { setMapRenderer3D } from '../../../view/map3d/scene/renderer-registry';
import type { MapRenderer3D } from '../../../view/map3d/scene/map-renderer';
import { SceneCamera, maxHeight } from '../../../view/map3d/camera/scene-camera';
import { islandBounds } from '../../../view/map3d/camera/controls';
import { layerToY, mapCenterOffset } from '../../../view/map3d/geometry/coords';
import { captureMapStills } from '../../../view/map3d/capture/stills';
import type { SeenView } from '../../../view/map3d/camera/camera-pose';
import type { CameraAngle } from '../../../state/view-camera';
import type { GridState } from '../../../core/model/types';
import type { ScreenBox } from '../../../tools/pointer/runtime';
import { setMapRenderer } from '../../../view/map2d/scene/renderer-registry';
import type { MapRenderer } from '../../../view/map2d/scene/map-renderer';
import { mapPictureFrame } from '../../../view/map2d/capture/thumbnail';
import type { MapFrame } from '../../../core/grid/map-chunks';
import { blueprintEditor, open, scene } from './_blueprints';

// Heard, not replaced: jsdom has no WebGL, so the still itself is never drawn.
vi.mock('../../../view/map3d/capture/stills', async (original) => {
  const actual = await original<typeof import('../../../view/map3d/capture/stills')>();
  return { ...actual, captureMapStills: vi.fn(actual.captureMapStills) };
});

blueprintEditor();
afterEach(() => { setActiveView(null); setMapRenderer3D(null, null); vi.mocked(captureMapStills).mockClear(); vi.restoreAllMocks(); });

const store = () => useEditorStore.getState();

/** A 3D scene's camera over `state` on a canvas of `aspect`, at rest as the scene frames it on opening. */
function sceneCamera(state: GridState, aspect: number): SceneCamera {
  const cam = new SceneCamera(aspect, document.createElement('div'), {
    requestRender: () => {}, viewportChanged: () => {}, template: () => state.template, viewHeight: () => 1,
  });
  cam.frame(islandBounds(state.template, layerToY(maxHeight(state))));
  cam.beginIntro(false);
  return cam;
}

/** Where `p` stands in a camera's picture, as shares of its width and height from the top left. */
function seenAt(camera: THREE.PerspectiveCamera, p: THREE.Vector3): { x: number; y: number } {
  camera.updateMatrixWorld();
  const v = p.clone().project(camera);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}

spec('BLUE-05', 'the 3D picture holds what the viewfinder showed of the live 3D view, from where the view stood', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ viewMode: '3d' });
  const state = store().gridState!;
  // The live view: a wide canvas at the top left of the window, turned and brought in on the frame.
  const canvas = { left: 0, top: 0, width: 1280, height: 800 };
  const live = sceneCamera(state, canvas.width / canvas.height);
  const off = mapCenterOffset(state.template.width, state.template.height);
  const mid = { x: sc.frame.x + sc.frame.w / 2, y: sc.frame.y + sc.frame.h / 2 };
  live.applyCameraAngle({ az: 40, el: 34, dist: 0.25, tx: 0, tz: 0 });
  live.controls.target.set(mid.x - off.x, live.controls.target.y, mid.y - off.z);
  live.camera.lookAt(live.controls.target);
  // The pointer's map point: the ground under a client point, as the 3D projection picks it.
  const under = (sx: number, sy: number) => {
    const ray = new THREE.Raycaster();
    live.camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2((sx / canvas.width) * 2 - 1, 1 - (sy / canvas.height) * 2), live.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
    return { x: hit.x + off.x, y: hit.z + off.z };
  };
  setActiveView({ projection: { screenToPoint: under } } as never);
  setMapRenderer3D({
    getCurrentAngle: () => live.getCurrentAngle(),
    seenIn: (box: ScreenBox): SeenView => ({
      ...live.pose(), aspect: canvas.width / canvas.height,
      part: { x: box.left / canvas.width, y: box.top / canvas.height, w: box.width / canvas.width, h: box.height / canvas.height },
    }),
  } as unknown as MapRenderer3D, state);
  // The viewfinder: above the dock, off the canvas's centre, at the pictures' shape.
  const crop = { left: 266, top: 175, width: 623, height: 623 / THUMB_ASPECT };
  const heard: FramedPictures[] = [];
  const stop = watchFramedThumbs(sc.frame, () => crop, (p) => { heard.push(p); }, 0);
  try {
    await waitFor(() => expect(heard.some((p) => p.lifted !== null)).toBe(true));
  } finally { stop(); }

  // The still as the capture's scene of the same map takes it, at the pictures' shape.
  const still = vi.mocked(captureMapStills).mock.calls.at(-1)![1]![0]!;
  const shot = sceneCamera(state, THUMB_ASPECT);
  if ('eye' in still) shot.showSeen(still);
  else shot.applyCameraAngle(still as CameraAngle);
  const ground = live.controls.target.y;
  for (const [dx, dy, y] of [[0, 0, ground], [-2, -2, 0], [3, -1, 1.5], [2, 3, 0], [-3, 2, 0.6]] as const) {
    const p = new THREE.Vector3(mid.x + dx - off.x, y, mid.y + dy - off.z);
    const onScreen = seenAt(live.camera, p);
    const inFinder = { x: (onScreen.x * canvas.width - crop.left) / crop.width, y: (onScreen.y * canvas.height - crop.top) / crop.height };
    const inPicture = seenAt(shot.camera, p);
    expect(inPicture.x).toBeCloseTo(inFinder.x, 3);
    expect(inPicture.y).toBeCloseTo(inFinder.y, 3);
  }
});

/** A 2D canvas transform, as `a b c d e f` of the canvas's own matrix. */
type Affine = readonly [number, number, number, number, number, number];
const times = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Affine, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** A canvas context that keeps its transform and the pictures drawn into it, as jsdom keeps none. */
interface Drawn { img: HTMLCanvasElement; m: Affine; dx: number; dy: number }
function recordCanvases(): { draws: Map<HTMLCanvasElement, Drawn[]>; encoded: HTMLCanvasElement[] } {
  const draws = new Map<HTMLCanvasElement, Drawn[]>();
  const encoded: HTMLCanvasElement[] = [];
  const contexts = new Map<HTMLCanvasElement, object>();
  const contextOf = (canvas: HTMLCanvasElement): object => {
    let m: Affine = [1, 0, 0, 1, 0, 0];
    const ctx = contexts.get(canvas) ?? {
      fillStyle: '', fillRect: () => {},
      translate: (x: number, y: number) => { m = times(m, [1, 0, 0, 1, x, y]); },
      rotate: (a: number) => { m = times(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
      drawImage: (img: HTMLCanvasElement, dx: number, dy: number) => { draws.set(canvas, [...(draws.get(canvas) ?? []), { img, m, dx, dy }]); },
    };
    contexts.set(canvas, ctx);
    return ctx;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) { return contextOf(this) as never; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) { encoded.push(this); return 'data:image/png;base64,AAAA'; });
  return { draws, encoded };
}

spec('BLUE-05', 'the 2D picture of a turned view shows the viewfinder\'s cells turned as the view showed them', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ viewMode: '2d' });
  const canvases = recordCanvases();
  // The renderer's photograph of a frame: ten px to a cell over the cells it covers.
  const shots = new Map<HTMLCanvasElement, MapFrame>();
  const PX = 10;
  setMapRenderer({
    captureState: async (state: GridState, options: { frame?: MapFrame } = {}) => {
      const region = mapPictureFrame(state, options.frame);
      const shot = document.createElement('canvas');
      shot.width = Math.round(region.width * PX);
      shot.height = Math.round(region.height * PX);
      shots.set(shot, region);
      return shot;
    },
  } as unknown as MapRenderer);
  // A 2D view turned 0.6 rad, twenty px to a cell, the frame's middle at the canvas's centre.
  const heading = 0.6, zoom = 20, centre = { x: 640, y: 400 };
  const mid = { x: sc.frame.x + sc.frame.w / 2, y: sc.frame.y + sc.frame.h / 2 };
  const screenToPoint = (sx: number, sy: number) => {
    const dx = (sx - centre.x) / zoom, dy = (sy - centre.y) / zoom;
    return { x: mid.x + dx * Math.cos(heading) - dy * Math.sin(heading), y: mid.y + dx * Math.sin(heading) + dy * Math.cos(heading) };
  };
  setActiveView({ projection: { screenToPoint } } as never);
  const crop = { left: 400, top: 260, width: 480, height: 480 / THUMB_ASPECT };
  const heard: FramedPictures[] = [];
  const stop = watchFramedThumbs(sc.frame, () => crop, (p) => { heard.push(p); }, 0);
  try {
    await waitFor(() => expect(heard.some((p) => p.flat !== null)).toBe(true));
  } finally { stop(); setMapRenderer(null); }

  /** Where map point `p` lands on `canvas`: through each picture drawn into it, down to the photograph. */
  const placeOf = (canvas: HTMLCanvasElement, p: { x: number; y: number }): { x: number; y: number } => {
    const region = shots.get(canvas);
    if (region) return { x: (p.x - region.x) * (canvas.width / region.width), y: (p.y - region.y) * (canvas.height / region.height) };
    const [drawn] = canvases.draws.get(canvas)!;
    const src = placeOf(drawn!.img, p);
    return apply(drawn!.m, src.x + drawn!.dx, src.y + drawn!.dy);
  };
  const picture = canvases.encoded.at(-1)!;
  for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.3, 0.8]] as const) {
    const at = placeOf(picture, screenToPoint(crop.left + sx * crop.width, crop.top + sy * crop.height));
    expect(at.x).toBeCloseTo(sx * picture.width, -0.5);
    expect(at.y).toBeCloseTo(sy * picture.height, -0.5);
  }
});
