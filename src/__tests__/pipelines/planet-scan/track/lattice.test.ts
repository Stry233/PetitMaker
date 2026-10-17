import { describe, expect, it, vi } from 'vitest';

// Synchronous lattice fits over synthetic frames; seconds per case under a loaded or instrumented run.
vi.setConfig({ testTimeout: 60_000 });
import { bridgeLostSteps, fitComb, fitScanLattice, frameLines, latticePins, lineProfiles, lineScratch, resolveChunkSlips, runLattice } from '../../../../pipelines/planet-scan/track/lattice';
import { EDGE_CLOSURE, EDGE_CONSECUTIVE, EdgeList, SOURCE_ASSUMED, SOURCE_LINES } from '../../../../pipelines/planet-scan/track/path-solve';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { dashPlane } from '../../../../pipelines/planet-scan/ground/color';
import { rgbaToGrey } from '../../../../pipelines/planet-scan/frame/rectify';
import { broadbandField, latticeDeviation as deviationAt, rng, toLine } from '../synthetic';

const { width: TW, height: TH } = SCAN_PROFILE.tile;
const PX = SCAN_PROFILE.chunk.width;
const PY = SCAN_PROFILE.chunk.height;
const CELL = SCAN_PROFILE.cell;

const wrapDiff = (a: number, b: number, p: number) => Math.abs(toLine(a, b, p));

describe('chunk lattice', () => {
  const origin = { x: 37.3, y: 51.9 };

  it('fits a comb to a profile of sub-pixel lines', () => {
    const profile = Float64Array.from({ length: 700 }, (_, i) => Math.exp(-(toLine(i, 20.37, PX) ** 2) / 2));
    const fit = fitComb(profile, PX, SCAN_PROFILE.lattice.scan)!;
    expect(wrapDiff(fit.phase, 20.37, PX)).toBeLessThan(0.05);
    expect(fit.deviations.length).toBe(6);
    expect(fit.spread).toBeLessThan(0.1);
  });

  it('locates the lattice inside one still run', () => {
    let pinned = 0;
    for (let k = 0; k < 8; k++) {
      const x = 150 * k + 13.4;
      // The tile is under two periods tall: its first horizontal line sits low enough for a second.
      const y = origin.y - (10 + 9 * k);
      const seen = runLattice(lineProfiles(deviationAt(x, y, origin, 50 + k)));
      expect(seen.x).not.toBeNull();
      expect(seen.y).not.toBeNull();
      // The run sees a line at tile offset phase, so scan line x + phase lies on the lattice.
      expect(wrapDiff(x + seen.x!, origin.x, PX)).toBeLessThan(0.1 * CELL.width);
      expect(wrapDiff(y + seen.y!, origin.y, PY)).toBeLessThan(0.1 * CELL.height);
      pinned++;
    }
    expect(pinned).toBe(8);
  });

  it('pins no axis on a run that shows one line across it, which gives no spread to judge', () => {
    // Horizontal lines at tile rows 98 and 203.6: only the first falls inside the tile.
    const seen = runLattice(lineProfiles(deviationAt(13.4, origin.y - 98, origin, 60)));
    expect(TH).toBeLessThan(98 + PY);
    expect(seen.x).not.toBeNull();
    expect(seen.y).toBeNull();
  });

  it('reads every image alike through one set of reused scratch planes', () => {
    const scratch = lineScratch(TW * TH);
    for (let k = 0; k < 4; k++) {
      const image = deviationAt(150 * k + 13.4, 40 * k - 7.1, origin, 70 + k);
      expect(lineProfiles(image, 1, scratch)).toEqual(lineProfiles(image));
    }
    // A smaller image reads in the front of larger planes.
    const half = { width: TW >> 1, height: TH >> 1, data: Float32Array.from({ length: (TW >> 1) * (TH >> 1) }, (_, i) => (i % 37) / 37) };
    expect(lineProfiles(half, 2, scratch)).toEqual(lineProfiles(half, 2));
  });

  it('pins nothing on a run without animated lines', () => {
    const r = rng(3);
    const data = Float32Array.from({ length: TW * TH }, () => 0.4 * r());
    const seen = runLattice(lineProfiles({ width: TW, height: TH, data }));
    expect(seen).toEqual({ x: null, y: null });
  });

  it('recovers the scan lattice phase within a tenth of a cell from placed runs', () => {
    const r = rng(8);
    const runs = [];
    for (let k = 0; k < 30; k++) {
      const x = (k % 10) * 140 + r() * 20;
      const y = Math.floor(k / 10) * 160 + r() * 10;
      // Runs sit where the path solve put them, a few tenths of a pixel from the truth.
      const placedX = x + (r() * 2 - 1) * 0.3;
      const placedY = y + (r() * 2 - 1) * 0.3;
      runs.push({ x: placedX, y: placedY, frames: 6 + Math.floor(r() * 20), profiles: lineProfiles(deviationAt(x, y, origin, 200 + k)) });
    }
    const lattice = fitScanLattice(runs);
    expect(lattice.period).toEqual({ x: PX, y: PY });
    expect(wrapDiff(lattice.x!.phase, origin.x, PX)).toBeLessThan(0.1 * CELL.width);
    expect(wrapDiff(lattice.y!.phase, origin.y, PY)).toBeLessThan(0.1 * CELL.height);
    expect(lattice.x!.lines).toBeGreaterThanOrEqual(13);
    expect(lattice.y!.lines).toBeGreaterThanOrEqual(5);
    expect(lattice.x!.residualRms).toBeLessThan(0.5);
    expect(lattice.y!.residualRms).toBeLessThan(0.5);
  });

  it('pins only still runs long enough to place the lattice', () => {
    const min = SCAN_PROFILE.latticeMinSeconds;
    const runs = [0, 1, 2].map((k) => ({
      distinct: 10 * k,
      frames: 12,
      seconds: k === 1 ? 0.9 * min : min + 0.01 * k,
      profiles: lineProfiles(deviationAt(150 * k, 20 * k, origin, 90 + k)),
    }));
    const pins = latticePins(runs);
    expect(Array.from(pins.x.frame)).toEqual([0, 20]);
    expect(Array.from(pins.y.frame)).toEqual([0, 20]);
    expect(wrapDiff(pins.x.phase[1]! + 300, origin.x, PX)).toBeLessThan(0.1 * CELL.width);
  });

  it('judges a pause by how long it lasted, so the same pause pins at any frame rate', () => {
    const profiles = lineProfiles(deviationAt(0, 0, origin, 93));
    const pause = (frames: number, fps: number) => ({ distinct: 0, frames, seconds: (frames - 1) / fps, profiles });
    // Ten frames at 60 fps and six at 30 fps last long enough; six frames at 60 fps do not.
    for (const [run, pins] of [[pause(10, 60), 1], [pause(SCAN_PROFILE.stillRunMinFrames, 30), 1], [pause(SCAN_PROFILE.stillRunMinFrames, 60), 0]] as const) {
      expect(latticePins([run]).x.frame.length).toBe(pins);
    }
  });

  it('adds each other kept frame\'s own lines as moving pins', () => {
    const runs = [{ distinct: 1, frames: 12, seconds: SCAN_PROFILE.latticeMinSeconds, profiles: lineProfiles(deviationAt(0, 0, origin, 91)) }];
    const lines = { x: [5, 6, Number.NaN, 8], y: [Number.NaN, 2, 3, Number.NaN] };
    const pins = latticePins(runs, undefined, lines);
    // Frame 1 is the still run's; its own line reading is not added again.
    expect(Array.from(pins.x.frame)).toEqual([1, 0, 3]);
    expect(Array.from(pins.x.moving!)).toEqual([0, 1, 1]);
    expect(Array.from(pins.x.phase.subarray(1))).toEqual([5, 8]);
    expect(Array.from(pins.y.frame)).toEqual([1, 2]);
    expect(latticePins(runs).x.moving).toBeUndefined();
  });

  it('keeps a frame\'s own line on an axis its still run did not read', () => {
    const read = lineProfiles(deviationAt(0, 0, origin, 92));
    const runs = [{ distinct: 1, frames: 12, seconds: SCAN_PROFILE.latticeMinSeconds, profiles: { ...read, y: new Float32Array(read.y.length) } }];
    expect(runLattice(runs[0]!.profiles)).toMatchObject({ y: null });
    const pins = latticePins(runs, undefined, { x: [Number.NaN, 6], y: [Number.NaN, 2] });
    expect(Array.from(pins.x.frame)).toEqual([1]);
    expect(Array.from(pins.y.frame)).toEqual([1]);
    expect(Array.from(pins.y.moving!)).toEqual([1]);
  });
});

describe('a kept frame\'s own lines', () => {
  const tileSize = { width: TW, height: TH };
  const ground = broadbandField(21, 512, 256);
  const dash = (v: number) => (Math.floor(v / (2 * CELL.width)) % 2 === 0 ? 1 : 0);
  /** A tile's plane of textured ground (RMS 8 levels) under dashed region load lines of 12, the
   *  tile's origin at (x, y) in scan pixels and the lines at `origin`. */
  const frameAt = (x: number, y: number, origin: { x: number; y: number }, seed: number) => {
    const tile = ground(x, y, tileSize, 1, seed);
    for (let r = 0; r < TH; r++) {
      for (let c = 0; c < TW; c++) {
        const sx = x + c, sy = y + r;
        const lx = Math.exp(-(toLine(sx, origin.x, PX) ** 2) / (2 * 1.5 ** 2)) * dash(sy);
        const ly = Math.exp(-(toLine(sy, origin.y, PY) ** 2) / (2 * 1.5 ** 2)) * dash(sx);
        tile.data[r * TW + c] = 0.4 * tile.data[r * TW + c]! + 12 * Math.max(lx, ly);
      }
    }
    return tile;
  };

  it('places the frame within a tenth of a cell on both axes at any sub-pixel position', () => {
    const origin = { x: 37.3, y: 51.9 };
    const worst = { x: 0, y: 0 };
    const read = { x: 0, y: 0 };
    for (let k = 0; k < 8; k++) {
      const at = { x: 61.7 * k + 0.37 * k, y: 23.3 * k + 0.61 * k };
      const seen = frameLines(frameAt(at.x, at.y, origin, 300 + k));
      // A line at tile offset t sits at scan position at + t. The tile is under two chunks tall, so
      // where only one horizontal line crosses it the y comb has no spread to judge and reads none.
      if (seen.x !== null) { read.x++; worst.x = Math.max(worst.x, wrapDiff(at.x + seen.x, origin.x, PX) / CELL.width); }
      if (seen.y !== null) { read.y++; worst.y = Math.max(worst.y, wrapDiff(at.y + seen.y, origin.y, PY) / CELL.height); }
    }
    expect(read).toEqual({ x: 8, y: 6 });
    expect(worst.x).toBeLessThan(0.1);
    expect(worst.y).toBeLessThan(0.1);
  });

  it('reads the lines where they lie, without a bias at sub-pixel positions', () => {
    const origin = { x: 37.3, y: 51.9 };
    const bias = { x: [] as number[], y: [] as number[] };
    for (let k = 0; k < 32; k++) {
      const at = { x: 17.3 * k + 0.13 * k, y: 9.7 * k + 0.29 * k };
      const seen = frameLines(frameAt(at.x, at.y, origin, 500 + k));
      if (seen.x !== null) bias.x.push(toLine(at.x + seen.x, origin.x, PX));
      if (seen.y !== null) bias.y.push(toLine(at.y + seen.y, origin.y, PY));
    }
    const mean = (v: number[]) => v.reduce((t, x) => t + x, 0) / v.length;
    expect(bias.x.length).toBeGreaterThan(24);
    expect(bias.y.length).toBeGreaterThan(16);
    expect(Math.abs(mean(bias.x))).toBeLessThan(0.2);
    expect(Math.abs(mean(bias.y))).toBeLessThan(0.2);
  });

  it('reads a dashed line over sand from the dash plane, where luma does not show it', () => {
    // Sand and its dashes as the recordings show them: the dash moves luma by under one level and
    // L* - a* + b* by 13 units. The sand carries grey texture of 4 levels RMS.
    const sand = [226, 197, 134] as const, dashed = [223, 203, 123] as const;
    const origin = { x: 37.3, y: 51.9 };
    const texture = broadbandField(33, 512, 256);
    let misses = 0;
    for (let k = 0; k < 6; k++) {
      const at = { x: 41.3 * k + 3.1, y: origin.y - 30 - 7.7 * k };
      const grain = texture(at.x, at.y, tileSize, 0, 700 + k);
      const tile = new Uint8Array(TW * TH * 4);
      for (let r = 0; r < TH; r++) {
        for (let c = 0; c < TW; c++) {
          const sx = at.x + c, sy = at.y + r;
          // Two staggered rows of dashes about 1.5 px apart make a horizontal line, a 2 px band a vertical one.
          const row = toLine(sy, origin.y, PY);
          const onY = (Math.abs(row + 0.75) < 0.5 && dash(sx)) || (Math.abs(row - 0.75) < 0.5 && dash(sx + CELL.width));
          const onX = Math.abs(toLine(sx, origin.x, PX)) < 1 && dash(sy);
          const g = 0.2 * grain.data[r * TW + c]!;
          for (let ch = 0; ch < 3; ch++) tile[(r * TW + c) * 4 + ch] = Math.round((onX || onY ? dashed : sand)[ch]! + g);
          tile[(r * TW + c) * 4 + 3] = 255;
        }
      }
      const rgba = { width: TW, height: TH, data: tile };
      const prior = { x: (((origin.x - at.x) % PX) + PX) % PX, y: (((origin.y - at.y) % PY) + PY) % PY };
      const luma = frameLines(rgbaToGrey(rgba), undefined, undefined, prior);
      if (luma.x === null || wrapDiff(at.x + luma.x, origin.x, PX) > 0.1 * CELL.width) misses++;
      if (luma.y === null || wrapDiff(at.y + luma.y, origin.y, PY) > 0.1 * CELL.height) misses++;
      const seen = frameLines(dashPlane(rgba), undefined, undefined, prior);
      expect(wrapDiff(at.x + seen.x!, origin.x, PX) / CELL.width).toBeLessThan(0.1);
      expect(wrapDiff(at.y + seen.y!, origin.y, PY) / CELL.height).toBeLessThan(0.1);
    }
    expect(misses).toBeGreaterThanOrEqual(10);
  });

  /** Adds a bright horizontal ridge of `strength` levels along tile row `row` (tile pixels), over
   *  the tile columns [x0, x1), dashed like the region load lines where `dashed`. */
  const addRow = (
    tile: { data: Float32Array; width: number; height: number }, row: number, strength: number,
    span: { readonly x0: number; readonly x1: number; readonly dashed: boolean } = { x0: 0, x1: TW, dashed: false },
  ) => {
    const { x0, x1, dashed } = span;
    for (let r = 0; r < tile.height; r++) {
      for (let c = Math.max(0, Math.ceil(x0)); c < Math.min(tile.width, x1); c++) {
        if (dashed && Math.floor(c / (2 * CELL.width)) % 2) continue;
        tile.data[r * tile.width + c]! += strength * Math.exp(-((r - row) ** 2) / (2 * 1.5 ** 2));
      }
    }
    return tile;
  };
  const lineRow = (y: number) => (((origin2.y - y) % PY) + PY) % PY;
  const origin2 = { x: 37.3, y: 51.9 };

  it('takes the line the tracked position predicts over a decoy ridge the comb alone prefers', () => {
    const at = { x: 13.4, y: origin2.y - 30 };
    // A straight ridge 22 px south of the true line, which outweighs the dashed line in the profile: a path's edge.
    const tile = addRow(frameAt(at.x, at.y, origin2, 900), lineRow(at.y) + 22, 14);
    expect(wrapDiff(at.y + (frameLines(tile).y ?? Number.NaN), origin2.y, PY)).not.toBeLessThan(5);
    const seen = frameLines(tile, undefined, undefined, { x: Number.NaN, y: lineRow(at.y) + 1.5 });
    expect(wrapDiff(at.y + seen.y!, origin2.y, PY) / CELL.height).toBeLessThan(0.1);
  });

  it('keeps the line on the ground where the dashes on a raised top are drawn north of it', () => {
    const at = { x: 13.4, y: origin2.y - 30 };
    const tile = frameAt(at.x, at.y, origin2, 910);
    // Over the tile's west 35 % the line runs over a layer-2 top: its dashes are drawn 14 px north
    // (the drawn offset and the lean), the ground's own dashes there hidden.
    const row = lineRow(at.y);
    for (let r = 0; r < tile.height; r++) for (let c = 0; c < tile.width * 0.35; c++) {
      tile.data[r * tile.width + c]! -= 12 * Math.exp(-((r - row) ** 2) / (2 * 1.5 ** 2)) * dash(at.x + c);
    }
    addRow(tile, row - 14, 12, { x0: 0, x1: 0.35 * TW, dashed: true });
    const seen = frameLines(tile, undefined, undefined, { x: Number.NaN, y: row - 2 });
    expect(wrapDiff(at.y + seen.y!, origin2.y, PY) / CELL.height).toBeLessThan(0.1);
    // A prediction near the shifted dashes finds nothing within its window there.
    expect(frameLines(tile, undefined, undefined, { x: Number.NaN, y: row - 25 }).y).toBeNull();
  });

  it('pins an axis on the one line in view where the tracked position predicts it', () => {
    // Horizontal lines at tile rows 98 and 203.6: only the first falls inside the tile.
    const at = { x: 13.4, y: origin2.y - 98 };
    const tile = frameAt(at.x, at.y, origin2, 920);
    expect(frameLines(tile).y).toBeNull();
    const seen = frameLines(tile, undefined, undefined, { x: Number.NaN, y: 98 });
    expect(wrapDiff(at.y + seen.y!, origin2.y, PY) / CELL.height).toBeLessThan(0.1);
  });
});

describe('chunk slips', () => {
  // Tracked pixels per line pixel: the ground moves 3 % faster than the lines, as on the recordings.
  const G = 1.03;
  const origin = 41.2;
  /** Positions, in line pixels, of frames taking `steps`; each frame's own line phase within a
   *  chunk, read a little off; and the consecutive edges, in tracked pixels, with the steps in
   *  `slipped` matched one ground chunk short. */
  const sweep = (steps: readonly number[], slipped: readonly number[] = []) => {
    const pos = [0];
    for (const d of steps) pos.push(pos[pos.length - 1]! + d);
    const lines = { x: pos.map((p, k) => (((origin - p) % PX) + PX) % PX + 0.2 * Math.sin(k)), y: pos.map(() => Number.NaN) };
    const edges = new EdgeList();
    // An edge from frame a to b states pos[a] - pos[b].
    steps.forEach((d, k) => edges.add(k, k + 1, { dx: G * (-d + (slipped.includes(k) ? Math.sign(d) * PX : 0)), dy: 0, weight: 1, kind: EDGE_CONSECUTIVE }));
    edges.add(0, 5, { dx: G * (pos[0]! - pos[5]!), dy: 0, weight: 1, kind: EDGE_CLOSURE });
    return { pos, lines, edges };
  };
  // A pan east in steps of one to three game frames of 0.21 chunk, as the recordings pan, then a
  // stop and a pan back west.
  const pan = [26, 51, 26, 77, 51, 77, 26, 51, 0, 0, -26, -51, -77, -26, -51, -26];

  it('moves a step tracked a chunk of ground short back onto the chunk the motion continues', () => {
    // Step 5 panned 77 line pixels east; matched a chunk of the repeating ground short, it reads 47 west.
    const { pos, lines, edges } = sweep(pan, [5]);
    expect(edges.dx[5]).toBeGreaterThan(0);
    const slips = resolveChunkSlips(edges, lines);
    expect(Array.from(slips.x)).toEqual([5]);
    expect(Array.from(slips.y)).toEqual([]);
    expect(slips.scale.x).toBeCloseTo(G, 2);
    // The two frames' own lines give the step to their reading's precision, in tracked pixels.
    expect(Math.abs(edges.dx[5]! - G * (pos[5]! - pos[6]!))).toBeLessThan(0.5);
  });

  it('takes the step one ground chunk on where a frame read no lines', () => {
    const { pos, lines, edges } = sweep(pan, [5]);
    const slips = resolveChunkSlips(edges, { x: lines.x.map((v, k) => (k === 6 ? Number.NaN : v)), y: lines.y });
    expect(Math.abs(edges.dx[5]! - G * (pos[5]! - pos[6]!))).toBeLessThan(0.02 * PX);
    expect(slips.scale.x).toBeCloseTo(G, 2);
  });

  it('leaves a pan whose steps vary by game frames, a stop and a turn as tracked', () => {
    const { lines, edges } = sweep(pan);
    const before = Array.from(edges.dx.subarray(0, edges.count));
    const slips = resolveChunkSlips(edges, lines);
    expect(slips.x.length + slips.y.length).toBe(0);
    expect(slips.suspect.x.length).toBe(0);
    expect(Array.from(edges.dx.subarray(0, edges.count))).toEqual(before);
  });

  it('keeps a reversal the chunk one on would fit worse, and counts it as a suspect', () => {
    // A step one game frame back between steps one game frame on: a chunk on lies farther from them.
    const { lines, edges } = sweep([26, 26, 26, -26, 26, 26, 26]);
    const before = edges.dx[3];
    const slips = resolveChunkSlips(edges, lines);
    expect(slips.x.length).toBe(0);
    expect(Array.from(slips.suspect.x)).toEqual([3]);
    expect(edges.dx[3]).toBe(before);
  });

  it('counts a step of five game frames that slipped to a small step forwards, and leaves it', () => {
    // 1.05 chunk read a ground chunk short is 0.015 chunk on: neither the motion nor the lines tell.
    const { lines, edges } = sweep([26, 51, 26, 5 * 0.21 * PX, 26, 51, 26], [3]);
    const before = edges.dx[3];
    const slips = resolveChunkSlips(edges, lines);
    expect(slips.x.length).toBe(0);
    expect(Array.from(slips.suspect.x)).toEqual([3]);
    expect(edges.dx[3]).toBe(before);
  });

  it('needs both neighbours moving: one just under `moving` of a chunk leaves the slip', () => {
    const under = 0.98 * SCAN_PROFILE.tracking.chunkSlip.moving * PX / G;
    const { lines, edges } = sweep([26, 51, under, 77, 51, 26, 51], [3]);
    const slips = resolveChunkSlips(edges, lines);
    expect(slips.x.length + slips.suspect.x.length).toBe(0);
    const { lines: l2, edges: e2 } = sweep([26, 51, under / 0.96, 77, 51, 26, 51], [3]);
    expect(Array.from(resolveChunkSlips(e2, l2).x)).toEqual([3]);
  });

  it('never moves a step it only assumed, nor one beside a frame the camera rested in', () => {
    const { lines, edges } = sweep(pan, [5, 9]);
    edges.source[5] = SOURCE_ASSUMED;
    expect(resolveChunkSlips(edges, lines).x.length).toBe(0);
  });
});

describe('lost steps', () => {
  const G = 1.02;
  const origin = { x: 41.2, y: 17.9 };
  /** Frames taking `steps` (line pixels, both axes alike); the steps in `lost` are assumed as
   *  tracking assumes them, repeating a wrong step. */
  const sweep = (steps: readonly (readonly [number, number])[], lost: readonly number[], read = (_k: number) => true) => {
    const pos = [{ x: 0, y: 0 }];
    for (const [dx, dy] of steps) pos.push({ x: pos[pos.length - 1]!.x + dx, y: pos[pos.length - 1]!.y + dy });
    const phase = (p: number, o: number, P: number) => (((o - p) % P) + P) % P;
    const lines = {
      x: pos.map((p, k) => (read(k) ? phase(p.x, origin.x, PX) + 0.1 * Math.sin(k) : Number.NaN)),
      y: pos.map((p, k) => (read(k) ? phase(p.y, origin.y, PY) + 0.1 * Math.cos(k) : Number.NaN)),
    };
    const edges = new EdgeList();
    steps.forEach(([dx, dy], k) => edges.add(k, k + 1, lost.includes(k)
      ? { dx: -0.9 * PX, dy: -0.9 * PY, weight: SCAN_PROFILE.tracking.solve.outlierWeight, kind: EDGE_CONSECUTIVE, source: SOURCE_ASSUMED }
      : { dx: -G * dx, dy: -G * dy, weight: 1, kind: EDGE_CONSECUTIVE }));
    return { pos, lines, edges };
  };

  it('places lost steps at rest and in a pan on their frames\' lines, nearest the motion around them', () => {
    // A camera at rest whose first steps tracking lost, as over open sea, then a pan with one step lost.
    const steps = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [26, 0], [51, 3], [51, 3], [77, 0], [51, 0], [26, 0]] as const;
    const { pos, lines, edges } = sweep(steps, [0, 1, 2, 7]);
    const placed = bridgeLostSteps(edges, lines, { x: G, y: G });
    expect(Array.from(placed)).toEqual([0, 1, 2, 7]);
    for (const e of placed) {
      expect(edges.source[e]).toBe(SOURCE_LINES);
      expect(edges.weight[e]).toBe(1);
      expect(Math.abs(edges.dx[e]! - G * (pos[e]!.x - pos[e + 1]!.x))).toBeLessThan(0.5);
      expect(Math.abs(edges.dy[e]! - G * (pos[e]!.y - pos[e + 1]!.y))).toBeLessThan(0.5);
    }
  });

  it('leaves a lost step its frames read no lines for, or one midway between two chunks', () => {
    const steps = [[26, 0], [26, 0], [26, 0], [26, 0], [26, 0]] as const;
    const blind = sweep(steps, [2], (k) => k !== 3);
    expect(Array.from(bridgeLostSteps(blind.edges, blind.lines, { x: G, y: G }))).toEqual([]);
    expect(blind.edges.source[2]).toBe(SOURCE_ASSUMED);
    // Half a chunk between neighbours at rest: the lost step's two candidates lie as near their mean.
    const torn = sweep([[0, 0], [0, 0], [PX / 2, 0], [0, 0], [0, 0]], [2]);
    expect(Array.from(bridgeLostSteps(torn.edges, torn.lines, { x: G, y: G }))).toEqual([]);
  });
});
