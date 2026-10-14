import { describe, expect, it } from 'vitest';
import { EDGE_CLOSURE, EDGE_CONSECUTIVE, EDGE_GATED, SOURCE_ASSUMED, SOURCE_RECOVERED, SOURCE_VERIFIED, solvePath } from '../../../../pipelines/planet-scan/track/path-solve';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { CropMatcher, TileStore, Tracker, agreeingOffsets, halveTile } from '../../../../pipelines/planet-scan/track/track';
import { broadbandField, cropAt, rasterPath, rng } from '../synthetic';

const TW = 200;
const TH = 100;
const FIELD_W = 1024;
const FIELD_H = 512;

describe('tracking', () => {
  const field = broadbandField(11, FIELD_W, FIELD_H)(0, 0, { width: FIELD_W, height: FIELD_H });
  // Half-resolution camera quanta; rows overlap by half a tile.
  const path = rasterPath(4, { x0: 4, x1: FIELD_W - TW - 6, y0: 4, y1: FIELD_H - TH - 6 }, { x: 12.85, y: 11 }, 50);
  const n = path.x.length;
  const truth = { x: path.x.map((v) => v - path.x[0]!), y: path.y.map((v) => v - path.y[0]!) };
  const tracker = new Tracker(TW, TH);
  for (let k = 0; k < n; k++) tracker.push(cropAt(field, { x: path.x[k]!, y: path.y[k]! }, { width: TW, height: TH }, 3, 100 + k));

  const maxError = (x: ArrayLike<number>, y: ArrayLike<number>) => {
    let m = 0;
    for (let k = 0; k < n; k++) m = Math.max(m, Math.hypot(x[k]! - truth.x[k]!, y[k]! - truth.y[k]!));
    return m;
  };

  it('follows every consecutive step of a raster scan', () => {
    expect(n).toBeGreaterThan(80);
    expect(tracker.frames).toBe(n);
    expect(tracker.lost).toBe(0);
    expect(tracker.edges.count).toBe(n - 1);
    // The running position is the chain path's last frame.
    const chain = tracker.chainPath();
    expect(tracker.position.x).toBeCloseTo(chain.x[n - 1]!, 9);
    expect(tracker.position.y).toBeCloseTo(chain.y[n - 1]!, 9);
    for (let e = 0; e < tracker.edges.count; e++) {
      expect(tracker.edges.source[e]).toBe(SOURCE_VERIFIED);
      expect(tracker.edges.ncc[e]).toBeGreaterThan(SCAN_PROFILE.tracking.consecutiveMinNcc);
    }
  });

  it('recovers a noisy raster path within a pixel with closures and the path solve', () => {
    const stats = tracker.addClosures();
    expect(stats.added).toBeGreaterThan(n);
    expect(stats.gated).toBe(0);
    for (let e = 0; e < tracker.edges.count; e++) {
      if (tracker.edges.kind[e] !== EDGE_CLOSURE) continue;
      const a = tracker.edges.a[e]!;
      const b = tracker.edges.b[e]!;
      expect(Math.abs(tracker.edges.dx[e]! - (truth.x[a]! - truth.x[b]!))).toBeLessThan(0.5);
      expect(Math.abs(tracker.edges.dy[e]! - (truth.y[a]! - truth.y[b]!))).toBeLessThan(0.5);
    }
    const sol = solvePath(n, tracker.edges);
    expect(maxError(sol.x, sol.y)).toBeLessThan(1);
  });

  it('drops a revisit that verifies far from the tracked path as an alias', () => {
    const fresh = new Tracker(TW, TH);
    for (let k = 0; k < 40; k++) fresh.push(cropAt(field, { x: path.x[k]!, y: path.y[k]! }, { width: TW, height: TH }, 3, 100 + k));
    const chain = fresh.chainPath();
    // A path that places the second row 60 pixels off: revisits across the rows verify 60 pixels
    // from where it predicts them.
    const rowTwo = path.y.findIndex((v) => v > path.y[0]! + 40);
    expect(rowTwo).toBeGreaterThan(0);
    expect(rowTwo).toBeLessThan(35);
    const wrong = { x: chain.x.map((v, k) => (k >= rowTwo ? v + 60 : v)), y: chain.y };
    const before = fresh.edges.count;
    const stats = fresh.addClosures(wrong);
    expect(stats.gated).toBeGreaterThan(0);
    // The gated matches agree on one offset: the predicted path is wrong, not aliased.
    expect(stats.agreeing).toBeGreaterThanOrEqual(2);
    expect(stats.failed).toBe(true);
    for (let e = before; e < fresh.edges.count; e++) {
      if (fresh.edges.kind[e] === EDGE_GATED) {
        expect(fresh.edges.weight[e]).toBe(0);
        continue;
      }
      const a = fresh.edges.a[e]!;
      const b = fresh.edges.b[e]!;
      expect(Math.abs(fresh.edges.dx[e]! - (truth.x[a]! - truth.x[b]!))).toBeLessThan(0.5);
    }
  });

  it('recovers a hitch that jumps the camera by most of a view', () => {
    const hitch = new Tracker(TW, TH);
    // 0.62 of the tile across: too little overlap for the whole-tile correlation.
    const jumps = [[300, 200], [300 + 124.3, 203.2], [300 + 124.3 - 12.8, 203.2]] as const;
    for (const [k, [x, y]] of jumps.entries()) hitch.push(cropAt(field, { x, y }, { width: TW, height: TH }, 3, 500 + k));
    expect(hitch.lost).toBe(0);
    expect(hitch.edges.source[0]).toBe(SOURCE_RECOVERED);
    expect(hitch.edges.dx[0]).toBeCloseTo(-124.3, 0);
    expect(hitch.edges.dy[0]).toBeCloseTo(-3.2, 0);
  });

  it('leaves a hitch on periodic ground unknown rather than taking an alias', () => {
    // Ground repeating every 128 pixels across: the true shift and the shift 128 pixels nearer
    // correlate alike. The diagonal jump leaves too little overlap for the whole tiles.
    const periodic = broadbandField(5, 128, 512)(0, 0, { width: 1024, height: 512 });
    const hitch = new Tracker(TW, TH);
    hitch.push(cropAt(periodic, { x: 300, y: 200 }, { width: TW, height: TH }, 3, 600));
    hitch.push(cropAt(periodic, { x: 424.3, y: 262 }, { width: TW, height: TH }, 3, 601));
    expect(hitch.lost).toBe(1);
    expect(hitch.edges.source[0]).toBe(SOURCE_ASSUMED);
    expect(hitch.edges.weight[0]).toBe(SCAN_PROFILE.tracking.solve.outlierWeight);
    // The same jump over non-repeating ground is recovered.
    const plain = new Tracker(TW, TH);
    plain.push(cropAt(field, { x: 300, y: 200 }, { width: TW, height: TH }, 3, 600));
    plain.push(cropAt(field, { x: 424.3, y: 262 }, { width: TW, height: TH }, 3, 601));
    expect(plain.edges.source[0]).toBe(SOURCE_RECOVERED);
    expect(plain.edges.dx[0]).toBeCloseTo(-124.3, 0);
    expect(plain.edges.dy[0]).toBeCloseTo(-62, 0);
  });

  it('assumes the last step across a frame it cannot match, and the solve reports it', () => {
    const lost = new Tracker(TW, TH);
    const r = rng(77);
    lost.push(cropAt(field, { x: 100, y: 100 }, { width: TW, height: TH }, 3, 700));
    lost.push(cropAt(field, { x: 112.8, y: 100 }, { width: TW, height: TH }, 3, 701));
    // A frame of noise: nothing in it matches.
    lost.push({ width: TW, height: TH, data: Float32Array.from({ length: TW * TH }, () => r() * 255) });
    lost.push(cropAt(field, { x: 138.4, y: 100 }, { width: TW, height: TH }, 3, 703));
    expect(lost.lost).toBe(2);
    expect(Array.from(lost.edges.source.subarray(0, 3))).toEqual([SOURCE_VERIFIED, SOURCE_ASSUMED, SOURCE_ASSUMED]);
    // Each assumed step repeats the last verified one.
    expect(lost.edges.dx[1]).toBeCloseTo(lost.edges.dx[0]!, 9);
    expect(Number.isNaN(lost.edges.ncc[1])).toBe(true);
    // The running position follows the assumed steps too: three times the verified step.
    expect(lost.position.x).toBeCloseTo(-3 * lost.edges.dx[0]!, 9);
    expect(lost.position.y).toBeCloseTo(-3 * lost.edges.dy[0]!, 9);
    expect(Array.from(solvePath(4, lost.edges).unbridged)).toEqual([1, 2]);
  });

  it('matches nothing on an overlap below the minimum crop', () => {
    const store = new TileStore(TW, TH);
    const tile = cropAt(field, { x: 100, y: 100 }, { width: TW, height: TH }, 0, 1);
    store.add(tile);
    store.add(tile);
    const matcher = new CropMatcher(store);
    const { minCropWidth, minCropHeight } = SCAN_PROFILE.tracking.closures;
    expect(matcher.match(0, 1, TW - minCropWidth + 1, 0, 0.5)).toBeNull();
    expect(matcher.match(0, 1, 0, TH - minCropHeight + 1, 0.5)).toBeNull();
    expect(matcher.match(0, 1, 0, 0, 0.5)).not.toBeNull();
  });

  it('retries on a second pass only the revisits that produced no closure', () => {
    const fresh = new Tracker(TW, TH);
    for (let k = 0; k < 40; k++) fresh.push(cropAt(field, { x: path.x[k]!, y: path.y[k]! }, { width: TW, height: TH }, 3, 100 + k));
    const chain = fresh.chainPath();
    const rowTwo = path.y.findIndex((v) => v > path.y[0]! + 40);
    const wrong = { x: chain.x.map((v, k) => (k >= rowTwo ? v + 60 : v)), y: chain.y };
    const first = fresh.addClosures(wrong);
    expect(first.gated).toBeGreaterThan(0);
    const count = fresh.edges.count;
    const kinds = () => Array.from(fresh.edges.kind.subarray(0, fresh.edges.count));
    // On the right path the pairs it tries verify; a gated pair's edge becomes its closure.
    const second = fresh.addClosures(chain);
    expect(second.tried).toBeGreaterThan(0);
    expect(second.added).toBeGreaterThan(0);
    expect(second.gated).toBe(0);
    expect(fresh.edges.count).toBeGreaterThanOrEqual(count);
    // No pair has two edges.
    const pairs = new Set<string>();
    for (let e = 0; e < fresh.edges.count; e++) {
      if (fresh.edges.kind[e] === EDGE_CONSECUTIVE) continue;
      const key = `${fresh.edges.a[e]}-${fresh.edges.b[e]}`;
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
    // Gated pairs the right path tries verify; the others keep their gated edge.
    expect(kinds().filter((k) => k === EDGE_GATED).length).toBeLessThan(first.gated);
    for (let e = 0; e < fresh.edges.count; e++) {
      if (fresh.edges.kind[e] !== EDGE_CLOSURE) continue;
      expect(fresh.edges.weight[e]).toBe(1);
      expect(Math.abs(fresh.edges.dx[e]! - (truth.x[fresh.edges.a[e]!]! - truth.x[fresh.edges.b[e]!]!))).toBeLessThan(0.5);
    }
    // A third pass on the same path finds nothing new.
    expect(fresh.addClosures(chain).added).toBe(0);
  });

  it('keeps tiles as clipped signed bytes', () => {
    const store = new TileStore(4, 1, 4);
    store.add({ width: 4, height: 1, data: Float32Array.from([1.26, -3, 40, -40]) });
    const out = store.crop(0, { x0: 0, y0: 0, width: 4, height: 1 }, new Float32Array(4)).data;
    expect(Array.from(out)).toEqual([1.25, -3, 31.75, -31.75]);
    expect(store.bytes).toBe(4);
  });

  it('halves a tile by box averaging', () => {
    const half = halveTile({ width: 4, height: 2, data: Float32Array.from([0, 2, 4, 6, 2, 4, 6, 8]) });
    expect([half.width, half.height]).toEqual([2, 1]);
    expect(Array.from(half.data)).toEqual([2, 6]);
  });
});

describe('agreeing revisit offsets', () => {
  it('counts revisits moved one way by a wrong path', () => {
    expect(agreeingOffsets([[60, 0], [61, 1], [59.5, -0.5], [-20, 7]], 3)).toBe(3);
  });

  it('cancels aliases of periodic ground found on both sides of the true shift', () => {
    const aliases: [number, number][] = [[-128.7, 0], [127.6, 0], [-127.2, 0.1], [-127, -0.5], [128.3, -0.1], [128.3, 0]];
    expect(agreeingOffsets(aliases, 3)).toBe(0);
    expect(agreeingOffsets(aliases, 3)).toBeLessThan(SCAN_PROFILE.tracking.closures.agreeingFailure);
  });

  it('cancels aliases however unevenly they fall on the two sides', () => {
    expect(agreeingOffsets([[127.4, 0.2], [-127.5, -0.7], [-128.7, 0.6], [-127.1, 0.6]], 3)).toBe(0);
  });
});
