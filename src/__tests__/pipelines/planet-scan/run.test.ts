import { describe, expect, it, vi } from 'vitest';

// Synchronous scan sessions over synthetic frames; seconds per case under a loaded or instrumented run.
vi.setConfig({ testTimeout: 60_000 });
import { ScanError } from '../../../pipelines/planet-scan/errors';
import { lineProfiles, periodScale, type RunProfiles } from '../../../pipelines/planet-scan/track/lattice';
import { SCAN_PROFILE } from '../../../pipelines/planet-scan/profile';
import { EDGE_CONSECUTIVE } from '../../../pipelines/planet-scan/track/path-solve';
import { firstPassFailure, latticeFailure, ScanSession, solveTracked, type FirstPassReading } from '../../../pipelines/planet-scan/run';
import type { ScanSolution } from '../../../pipelines/planet-scan/track/scan-solve';
import { Tracker } from '../../../pipelines/planet-scan/track/track';
import type { GreyImage } from '../../../pipelines/planet-scan/types';
import { broadbandField, cropAt, hudFrame, latticeDeviation, plainFrame, rasterPath, rng, toLine } from './synthetic';

const { width: TW, height: TH } = SCAN_PROFILE.tile;
const origin = { x: 37.3, y: 51.9 };

/** A still run's deviation whose animated lines repeat every `scale` calibrated periods. */
function scaledDeviation(x: number, y: number, scale: number, seed: number): GreyImage {
  const PX = SCAN_PROFILE.chunk.width * scale;
  const PY = SCAN_PROFILE.chunk.height * scale;
  const r = rng(seed);
  const data = new Float32Array(TW * TH);
  for (let row = 0; row < TH; row++) {
    for (let c = 0; c < TW; c++) {
      const lx = 3 * Math.exp(-(toLine(x + c, origin.x, PX) ** 2) / (2 * 0.8 ** 2));
      const ly = 2 * Math.exp(-(toLine(y + row, origin.y, PY) ** 2) / (2 * 0.8 ** 2));
      data[row * TW + c] = Math.max(lx, ly) + 0.4 * r();
    }
  }
  return { width: TW, height: TH, data };
}

function noise(seed: number): GreyImage {
  const r = rng(seed);
  return { width: TW, height: TH, data: Float32Array.from({ length: TW * TH }, () => 0.4 * r()) };
}

const runsOf = (images: GreyImage[]): RunProfiles[] => images.map((dev, k) => ({ distinct: k * 3, frames: 20, profiles: lineProfiles(dev) }));

const lined = runsOf(Array.from({ length: 10 }, (_, k) => latticeDeviation(150 * k + 13.4, 40 * k - 7.1, origin, 50 + k)));

const reading = (over: Partial<FirstPassReading> = {}): FirstPassReading => ({
  mapFrames: 2000, knobRows: Array.from({ length: 50 }, () => SCAN_PROFILE.hud.zoom.knobCentre), distinct: 300, runs: lined, ...over,
});

describe('what pass 1 tells about a recording', () => {
  it('accepts a map-view scan whose still runs show the chunk lines', () => {
    expect(firstPassFailure(reading())).toBeNull();
  });

  it('refuses a recording with too few map-view frames', () => {
    expect(firstPassFailure(reading({ mapFrames: SCAN_PROFILE.hud.minFrames - 1 }))).toBe('not-map-view');
  });

  it('refuses another zoom read from the slider knob', () => {
    expect(firstPassFailure(reading({ knobRows: Array.from({ length: 50 }, () => SCAN_PROFILE.hud.zoom.knobCentre - 30) }))).toBe('different-zoom');
  });

  it('refuses a scan with too few distinct frames as covering too little', () => {
    expect(firstPassFailure(reading({ distinct: SCAN_PROFILE.import.minDistinct - 1 }))).toBe('too-little');
  });

  it('reads still runs without lines as the region load display being off', () => {
    expect(firstPassFailure(reading({ runs: runsOf(Array.from({ length: 10 }, (_, k) => noise(k + 1))) }))).toBe('region-load-off');
  });

  it('reads lines of another period as another zoom', () => {
    const runs = runsOf(Array.from({ length: 10 }, (_, k) => scaledDeviation(150 * k + 13.4, 40 * k - 7.1, 1.25, 80 + k)));
    const seen = periodScale(runs);
    expect(Math.abs(seen.scale - 1.25)).toBeLessThan(0.03);
    expect(firstPassFailure(reading({ runs }))).toBe('different-zoom');
    expect(Math.abs(periodScale(lined).scale - 1)).toBeLessThan(0.03);
  });

  it('blames the window\'s shape for another period only where its world scale was never measured and the knob shows the calibrated zoom', () => {
    const runs = runsOf(Array.from({ length: 10 }, (_, k) => scaledDeviation(150 * k + 13.4, 40 * k - 7.1, 1.25, 80 + k)));
    expect(firstPassFailure(reading({ runs, worldMeasured: false }))).toBe('framing');
    expect(firstPassFailure(reading({ runs, worldMeasured: false, knobRows: [] }))).toBe('different-zoom');
    expect(firstPassFailure(reading({ runs, worldMeasured: true }))).toBe('different-zoom');
  });
});

describe('a scan session', () => {
  it('refuses a recording that never shows the map view', () => {
    const { width, height } = SCAN_PROFILE.frame;
    const session = new ScanSession();
    const data = new Uint8ClampedArray(width * height * 4).fill(120);
    for (let k = 0; k < SCAN_PROFILE.hud.startWithin - 1; k++) session.push({ width, height, data }, k / 60);
    expect(session.accepting).toBe(true);
    session.push({ width, height, data }, 10);
    expect(session.accepting).toBe(false);
    expect(session.distinct).toBe(0);
    expect(() => session.endFirstPass()).toThrow(ScanError);
    try { new ScanSession().endFirstPass(); } catch (e) { expect((e as ScanError).reason).toBe('not-map-view'); }
  });

  it('takes its passes in order', () => {
    const session = new ScanSession();
    expect(() => session.finish()).toThrow();
    expect(() => session.pushDistinct(0, { width: 1, height: 1, data: new Uint8ClampedArray(4) })).toThrow();
  });
});

describe('the tracked path', () => {
  const W = 200;
  const H = 100;
  const field = broadbandField(11, 1024, 512)(0, 0, { width: 1024, height: 512 });
  const path = rasterPath(4, { x0: 4, x1: 1024 - W - 6, y0: 4, y1: 512 - H - 6 }, { x: 12.85, y: 11 }, 50);
  const n = path.x.length;
  /** A tracker over the raster scan whose edges `tamper` then changes. */
  const tracked = (tamper: (t: Tracker) => void) => {
    const t = new Tracker(W, H);
    for (let k = 0; k < n; k++) t.push(cropAt(field, { x: path.x[k]!, y: path.y[k]! }, { width: W, height: H }, 3, 100 + k));
    tamper(t);
    return t;
  };
  // Every step read 1.5 pixels long on x: the chain path drifts past the revisit gate.
  const drifting = (t: Tracker) => {
    for (let e = 0; e < t.edges.count; e++) if (t.edges.kind[e] === EDGE_CONSECUTIVE) t.edges.dx[e] = t.edges.dx[e]! + 1.5;
  };

  it('tries revisits gated on a drifting chain again on the solved path', () => {
    expect(tracked(drifting).addClosures().failed).toBe(true);
    const sol = solveTracked(tracked(drifting), []);
    let error = 0;
    // Positions are tile origins: the content moves the other way.
    for (let k = 0; k < n; k++) error = Math.max(error, Math.hypot(sol.path.x[k]! - (path.x[k]! - path.x[0]!), sol.path.y[k]! - (path.y[k]! - path.y[0]!)));
    expect(error).toBeLessThan(2.5);
  });

  it('calls the camera too fast when revisits still gate on the solved path', () => {
    // One step 60 pixels wrong where the second row starts: every revisit across it gates.
    const rowTwo = path.y.findIndex((v) => v > path.y[0]! + 40);
    const jump = tracked((t) => {
      t.edges.dx[rowTwo - 1] = t.edges.dx[rowTwo - 1]! + 60;
    });
    expect(() => solveTracked(jump, [])).toThrow(ScanError);
  });
});

describe('the solved lattice', () => {
  const solved = (x: [number, number], y: [number, number]) =>
    ({ path: { lattice: { x: { accepted: x[0], pins: x[1] }, y: { accepted: y[0], pins: y[1] } } } }) as unknown as ScanSolution;
  const share = SCAN_PROFILE.import.minPinShare;

  it('is trusted when the solve kept most pins on both axes', () => {
    expect(latticeFailure(solved([36, 36], [40, 41]))).toBeNull();
    expect(latticeFailure(solved([Math.ceil(share * 20), 20], [20, 20]))).toBeNull();
  });

  it('calls the recording blurry when the solve dropped most of one axis of pins', () => {
    expect(latticeFailure(solved([13, 29], [37, 38]))).toBe('blurry');
    expect(latticeFailure(solved([40, 40], [12, 37]))).toBe('blurry');
  });
});

describe('the scan session\'s bounds', () => {
  const { width: FW, height: FH } = SCAN_PROFILE.frame;
  const hud = { mapView: true, whole: true, knob: SCAN_PROFILE.hud.zoom.knobCentre };

  it('refuses a scan past its kept-frame cap as too long, before it holds another tile', () => {
    const session = new ScanSession({ maxDistinct: 20 });
    const frame = { width: FW, height: FH, data: plainFrame() };
    const r = rng(3);
    let error: unknown = null;
    let pushed = 0;
    try {
      for (; pushed < 200; pushed++) session.pushPrepared(frame, { hud, tile: Float32Array.from({ length: TW * TH }, () => 255 * r()) }, pushed / 60);
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ScanError);
    expect((error as ScanError).reason).toBe('too-long');
    expect(session.distinct).toBe(20);
  });

  it('keeps a long slow pan under its cap by thinning its distinct frames', () => {
    const cap = 60;
    const session = new ScanSession({ maxDistinct: cap });
    const frame = { width: FW, height: FH, data: plainFrame() };
    const field = broadbandField(31, 2048, 512)(0, 0, { width: 2048, height: 512 });
    // Three times the cap's frames when the gap limit allows; without thinning each is kept.
    const frames = Math.min(3, SCAN_PROFILE.tracking.thinning.maxGap * 0.75) * cap;
    for (let k = 0; k < frames; k++) session.pushPrepared(
      frame, { hud, tile: cropAt(field, { x: 4 + 1.5 * k, y: 4 + 0.2 * k }, { width: TW, height: TH }).data as Float32Array<ArrayBuffer> }, k / 60,
    );
    expect(frames).toBeGreaterThan(cap);
    expect(session.distinct).toBeGreaterThan(frames / 20);
    expect(session.distinct).toBeLessThan(cap);
  });

  it('caps one import at the profile\'s kept frames by default', () => {
    expect(SCAN_PROFILE.import.maxDistinct).toBeGreaterThan(1000);
  });

  it('refuses a recording whose survey found no game window as framed wrong', () => {
    expect(firstPassFailure(reading({ mapFrames: 0, unframed: true }))).toBe('framing');
    expect(firstPassFailure(reading({ mapFrames: 0 }))).toBe('not-map-view');
  });

  it('reads nothing of a recording without a game window and refuses it as framed wrong', () => {
    const session = new ScanSession({ framing: null });
    expect(session.accepting).toBe(false);
    session.push({ width: FW, height: FH, data: hudFrame() }, 0);
    expect(() => session.endFirstPass()).toThrow(expect.objectContaining({ reason: 'framing' }));
  });
});
