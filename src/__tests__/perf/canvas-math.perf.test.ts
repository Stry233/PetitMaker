/*
 * canvas-math.perf.test.ts — the canvas layer's pure math, no Pixi/GL: chunk culling, the marquee's
 * band collection, the selection-hover decision, wheel-intent classification, and the plan-notes
 * route/zone geometry. Every one of these runs on the main thread once per frame or per pointer
 * event, so their cost is the renderer's own headroom rather than a generator's. See `_harness.ts`
 * for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { denseIsland } from './_fixtures';
import { CHUNK_SIZE, TILE_SIZE } from '../../core/model/constants';
import { chunkVisible, cullRect } from '../../canvas/map2d/layers/chunk-cull';
import { objectsInBand, type MacroRect } from '../../canvas/interaction/marquee';
import { selectionHoverBox } from '../../canvas/interaction/selection-hover';
import { WheelClassifier, type WheelLike } from '../../canvas/interaction/gestures';
import { roundedZoneLoops, routeSamples } from '../../core/model/annotations';
import type { RouteNote, ZoneNote } from '../../core/model/annotations';
import type { CurveAnchor } from '../../core/model/spline';
import { ToolType } from '../../core/model/types';
import type { MacroCoord } from '../../core/model/types';

const s = perfSuite('canvas-math');

describe.runIf(PERF)('perf: canvas-math', () => {
  it('chunk-cull sweep over ~200 camera rects', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const chunksX = Math.ceil(width / CHUNK_SIZE);
    const chunksY = Math.ceil(height / CHUNK_SIZE);
    const mapPxW = width * TILE_SIZE, mapPxH = height * TILE_SIZE;
    const cameras = Array.from({ length: 200 }, (_, i) => ({
      offsetX: (i * 137) % (mapPxW * 4),
      offsetY: (i * 271) % (mapPxH * 4),
      zoom: 0.4 + (i % 6) * 0.25,
      screenW: 1280,
      screenH: 800,
    }));
    await s.bench('cull/chunk-sweep', () => {
      let visible = 0;
      for (const cam of cameras) {
        const rect = cullRect(cam.offsetX, cam.offsetY, cam.zoom, cam.screenW, cam.screenH);
        for (let cy = 0; cy < chunksY; cy++) for (let cx = 0; cx < chunksX; cx++) if (chunkVisible(cx, cy, rect)) visible++;
      }
      return visible;
    }, { meta: { cameras: cameras.length, chunks: chunksX * chunksY } });
  });

  it('marquee band collection over 100 rects', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const bands: MacroRect[] = Array.from({ length: 100 }, (_, i) => ({
      x: (i * 13) % Math.max(1, width - 12),
      y: (i * 29) % Math.max(1, height - 12),
      w: 3 + (i % 12),
      h: 3 + ((i * 3) % 12),
    }));
    await s.bench('marquee/band-collect', () => {
      let total = 0;
      for (const rect of bands) total += objectsInBand(state, rect).length;
      return total;
    }, { meta: { bands: bands.length, objects: state.objects.size } });
  });

  it('selection-hover decision x1000 over scattered positions', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const positions: MacroCoord[] = Array.from({ length: 1000 }, (_, i) => ({
      x: (i * 7) % width, y: (i * 11) % height,
    }));
    await s.bench('hover/selection-decision', () => {
      for (const p of positions) selectionHoverBox(state, p, ToolType.Hand, null, false, []);
    }, { meta: { positions: positions.length } });
  });

  it('wheel classification over a synthetic 500-event stream', async () => {
    const events: { e: WheelLike; t: number }[] = [];
    let t = 0;
    for (let i = 0; i < 500; i++) {
      t += i % 2 === 0 ? 16 : 8; // ~60fps ticks, some doubled — inside and outside the sticky window
      const touchpad = i % 3 !== 0;
      events.push({
        t,
        e: touchpad
          ? { deltaX: (i % 5) - 2, deltaY: 2.3 * ((i % 7) - 3), deltaMode: 0, ctrlKey: false } // fractional, diagonal
          : { deltaX: 0, deltaY: 120 * (i % 2 === 0 ? 1 : -1), deltaMode: 0, ctrlKey: false }, // a mouse notch
      });
    }
    await s.bench('gestures/wheel-classify', () => {
      const classifier = new WheelClassifier();
      for (const { e, t: at } of events) classifier.classify(e, at);
    }, { meta: { events: events.length } });
  });

  it('route sampling + zone boundary loops over a 20-note annotation set', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const routes: RouteNote[] = Array.from({ length: 10 }, (_, i) => {
      const points: CurveAnchor[] = Array.from({ length: 6 }, (_, j) => ({
        x: (i * 17 + j * 23) % width, y: (i * 31 + j * 19) % height,
      }));
      return { kind: 'route', id: `r${i}`, points, color: '#38BDF8', dashed: i % 2 === 0 };
    });
    const zones: ZoneNote[] = Array.from({ length: 10 }, (_, i) => {
      const cx = (i * 37) % Math.max(1, width - 8), cy = (i * 41) % Math.max(1, height - 8);
      const cells: MacroCoord[] = [];
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) cells.push({ x: cx + dx, y: cy + dy });
      return { kind: 'zone', id: `z${i}`, cells, color: '#9BC53D', name: `Zone ${i}`, num: i + 1 };
    });
    await s.bench('annotations/route-sample', () => {
      for (const r of routes) routeSamples(r.points, 8);
      for (const z of zones) roundedZoneLoops(z.cells);
    }, { meta: { routes: routes.length, zones: zones.length } });
  });
});
