// @vitest-environment jsdom
/** The 3D scene draws on demand: an idle map rests, object edits owe their whole-map work once per drawn frame, and the shadow bake is keyed after the light state is set up. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../core/commands/event-bus';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import { TerrainType, type PlacedObject } from '../../../../core/model/types';
import { type EditorEvents } from '../../../../state/editing/events';
import { setGlQualityOverride } from '../../../../platform/device/device-quality';
import { FrameLoop } from '../../../../view/shared/viewport/frame-loop';

/** The frames one request draws, as the shared frame loop keeps it. */
function requestWindow(): number {
  const loop = new FrameLoop(() => {});
  loop.request();
  let frames = 0;
  while (loop.advance()) frames++;
  return frames;
}
import { makeState, setTerrain } from '../../../_support/map-state';
import { stubCanvasContext } from '../../../_support/canvas-context';
import { anyContext, rendererLog } from '../../../_support/three-stand-in';

vi.mock('three', async (importOriginal) =>
  (await import('../../../_support/three-stand-in')).withStandInRenderer(await importOriginal()));
vi.mock('../../../../view/shared/road/material-texture', () => ({
  roadMaterialTexture: () => Object.assign(document.createElement('canvas'), { width: 4, height: 4 }),
}));

const pending = new Map<number, FrameRequestCallback>();
let nextId = 1;

beforeEach(() => {
  pending.clear();
  rendererLog.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending.set(nextId, cb); return nextId++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setGlQualityOverride(null);
});

/** Runs every frame requested so far; returns how many ran. */
function runFrames(): number {
  const due = [...pending.values()];
  pending.clear();
  for (const cb of due) cb(performance.now());
  return due.length;
}

/** Runs frames until none is requested. */
function settle(): number {
  let frames = 0;
  for (let n = runFrames(); n > 0; n = runFrames()) frames += n;
  return frames;
}

const renders = (): number => rendererLog.filter((entry) => entry === 'render').length;

/** A raised pool beside open ground, so the map has still water and a waterfall face. */
async function scene() {
  stubCanvasContext(anyContext());
  const { MapRenderer3D } = await import('../../../../view/map3d/scene/map-renderer');
  const state = makeState(20, 20);
  for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) setTerrain(state, x, y, TerrainType.Mountain, 2);
  for (const [x, y] of [[4, 4], [5, 4]] as const) setTerrain(state, x, y, TerrainType.Water, 2);
  const bus = new EventBus<EditorEvents>();
  const three = new MapRenderer3D(document.createElement('div'), state, bus);
  return { three, state, bus };
}

describe('the 3D render loop', () => {
  it('draws the requested window and then rests, water and waterfalls included', async () => {
    const { three } = await scene();
    rendererLog.length = 0;
    settle();
    expect(renders()).toBe(requestWindow());
    expect(pending.size, 'no frame is requested at rest').toBe(0);
    three.requestRender();
    settle();
    expect(renders()).toBe(2 * requestWindow());
    three.destroy();
  });

  it('answers a paint waiter with the next drawn frame', async () => {
    const { three } = await scene();
    settle();
    const painted = vi.fn();
    three.onNextPaint(painted);
    expect(painted).not.toHaveBeenCalled();
    runFrames();
    expect(painted).toHaveBeenCalledOnce();
    three.destroy();
  });
});

describe('object edits in 3D', () => {
  it('owe one road rebuild, one icon refinement and one chrome nudge per drawn frame, however many events arrive', async () => {
    const { RoadSurfaces3D } = await import('../../../../view/map3d/layers/road-surfaces');
    const { ObjectLayer3D } = await import('../../../../view/map3d/layers/object-layer');
    const { three, state, bus } = await scene();
    settle();
    const rebuilds = vi.spyOn(RoadSurfaces3D.prototype, 'rebuild');
    const refines = vi.spyOn(ObjectLayer3D.prototype, 'refineIconColors');
    const nudges = vi.fn();
    bus.on('viewport-changed', nudges);

    for (let i = 0; i < 50; i++) {
      const road: PlacedObject = { id: `road${i}`, catalogId: 'path-urban-asphalt', position: { x: 10 + (i % 8), y: 10 + Math.floor(i / 8) }, rotation: 0, elevation: 0 };
      state.objects.set(road.id, road);
      bumpObjectsVersion(state, { added: [road] });
      bus.emit('objects-changed', { added: [road] });
    }
    expect(rebuilds).not.toHaveBeenCalled();
    expect(refines).not.toHaveBeenCalled();
    expect(nudges).not.toHaveBeenCalled();

    runFrames();
    expect(rebuilds).toHaveBeenCalledTimes(1);
    expect(refines).toHaveBeenCalledTimes(1);
    expect(nudges).toHaveBeenCalledTimes(1);

    settle();
    expect(rebuilds).toHaveBeenCalledTimes(1);
    expect(refines).toHaveBeenCalledTimes(1);
    expect(nudges).toHaveBeenCalledTimes(1);
    three.destroy();
  });
});

describe('the shadow map', () => {
  it('is frozen, then the light state is primed offscreen, then the one bake is asked for', async () => {
    setGlQualityOverride('full');
    const { three } = await scene();
    const from = rendererLog.indexOf('shadow.autoUpdate=false');
    expect(from).toBeGreaterThan(-1);
    expect(rendererLog.slice(from, from + 6)).toEqual([
      'shadow.autoUpdate=false', 'shadow.needsUpdate=false', 'target:offscreen', 'render', 'target:canvas', 'shadow.needsUpdate=true',
    ]);
    three.destroy();
  });
});
