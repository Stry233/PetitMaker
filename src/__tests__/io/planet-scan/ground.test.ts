import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, PLANET_PROFILE } from '../../../core/model/game-profile';
import { isGrassZone, isLandZone } from '../../../core/model/grid-model';
import { isTrustedPlanet } from '../../../core/model/planet-validate';
import { CellZone } from '../../../core/model/types';
import { fitPalette, paletteLookup, readGround, type GroundReading } from '../../../io/planet-scan/classify';
import { GRASS, PaletteSampler, SAND, SEA } from '../../../io/planet-scan/colour';
import { EvidenceAccumulator, evidenceGrid, reduceDeviation, type CellEvidence } from '../../../io/planet-scan/evidence';
import { detectPlaza } from '../../../io/planet-scan/plaza';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';
import { scannedPlanet } from '../../../io/planet-scan/to-template';
import { bareGridState, groundUnderRim, NO_PLANET_PLAZA, planetPlazaObject } from '../../../core/model/planet';
import { sessionPlanet } from '../../../kit/operations/planet-session';
import { ScanError } from '../../../io/planet-scan/errors';
import type { FramePosition } from '../../../io/planet-scan/scan-solve';
import {
  islandScene, paintWorld, PLAZA_AT, SAND_NOTCH, scanPositions, SHADOW_NOTCH, testLattice, viewDeviation, viewTile, type CellRect, type Scene,
} from './ground-synthetic';

vi.setConfig({ testTimeout: 60_000 });

const { width: W, height: H } = SCAN_PROFILE.tile;

interface Run {
  scene: Scene;
  ev: CellEvidence;
  reading: GroundReading;
}

/** Scans `scene` row by row; `keep` drops frame positions, as a partial scan would. */
function scan(scene: Scene, keep: (p: FramePosition, all: readonly FramePosition[]) => boolean = () => true): Run {
  const lattice = testLattice(37.3, 81.9);
  const world = paintWorld(scene, lattice);
  const all = scanPositions(world, W, H);
  const positions = all.filter((p) => keep(p, all));
  const tiles = positions.map((p, k) => viewTile(world, p, W, H, k, (k % 5) / 4));
  const sampler = new PaletteSampler(W, H);
  tiles.forEach((t, k) => sampler.push(t, positions[k]!));
  const lut = paletteLookup(fitPalette(sampler.samples()));
  const grid = evidenceGrid(lattice, positions, W, H);
  expect(Math.abs(grid.cellX0 % CHUNK_SIZE)).toBe(0);
  expect(Math.abs(grid.cellY0 % CHUNK_SIZE)).toBe(0);
  const acc = new EvidenceAccumulator(grid, lattice, lut, W, H);
  tiles.forEach((t, k) => acc.addFrame(t, positions[k]!));
  for (const p of positions) acc.addDeviation(reduceDeviation(viewDeviation(world, p, W, H)), p, 12);
  const ev = acc.finish();
  return { scene, ev, reading: readGround(ev) };
}

/** The scene's ground at a grid cell. */
function truth(run: Run, c: number, r: number): number {
  const { cellX0, cellY0 } = run.ev.grid;
  const x = cellX0 + c;
  const y = cellY0 + r;
  const { scene } = run;
  return x >= 0 && y >= 0 && x < scene.cols && y < scene.rows ? scene.ground[y * scene.cols + x]! : SEA;
}

const withPlaza = scan(islandScene({ plaza: PLAZA_AT }));
const withoutPlaza = scan(islandScene());

/** The grid index of lattice cell (x, y) in a run. */
const at = (run: Run, x: number, y: number) => (y - run.ev.grid.cellY0) * run.ev.grid.cols + x - run.ev.grid.cellX0;

const cellsOf = (r: CellRect) => Array.from({ length: r.w * r.h }, (_, k) => [r.x + (k % r.w), r.y + Math.floor(k / r.w)] as const);

describe('reading the ground of a synthetic scan', () => {
  it('reproduces the grass exactly, under builds and the landmark too', () => {
    for (const run of [withPlaza, withoutPlaza]) {
      const { cols, rows, ground } = run.reading;
      const wrong: string[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((ground[r * cols + c] === GRASS) !== (truth(run, c, r) === GRASS)) wrong.push(`${c},${r}`);
        }
      }
      expect(wrong).toEqual([]);
    }
  });

  it('keeps land errors within two cells of the coast and drops sand not connected to the grass', () => {
    const run = withoutPlaza;
    const { cols, rows, ground } = run.reading;
    const { cellX0, cellY0 } = run.ev.grid;
    for (let y = 10; y < 15; y++) for (let x = 96; x < 103; x++) expect(ground[(y - cellY0) * cols + x - cellX0]).toBe(SEA);
    const far: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const land = ground[r * cols + c] !== SEA;
        const t = truth(run, c, r);
        if (land === (t !== SEA) || (t === SAND && x(c, r))) continue;
        // The synthetic beach is not the game's, which the shore model learned, so the coast may be
        // off by up to two cells here.
        let coast = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((truth(run, c + dx, r + dy) !== SEA) !== (t !== SEA)) coast = true;
        if (!coast) far.push(`${c + cellX0},${r + cellY0}:${t}>${ground[r * cols + c]}`);
      }
    }
    function x(c: number, r: number) {
      return c + cellX0 >= 96 && c + cellX0 < 103 && r + cellY0 >= 10 && r + cellY0 < 15;
    }
    expect(far).toEqual([]);
  });

  it('flags the grass hidden under a build on the edge as inferred, and few cells besides', () => {
    const run = withoutPlaza;
    const { cols, inferred } = run.reading;
    const { cellX0, cellY0 } = run.ev.grid;
    for (let y = 40; y < 46; y++) for (let x = 79; x < 82; x++) expect(inferred[(y - cellY0) * cols + x - cellX0]).toBe(1);
    const flagged = inferred.reduce((n, v) => n + v, 0);
    // The edge build (18 cells), the inner build (12) and stray coast cells.
    expect(flagged).toBeLessThan(60);
  });

  it('marks cells no frame saw as unseen', () => {
    const { unseen, cols } = withoutPlaza.reading;
    expect(unseen[0]).toBe(1);
    const { cellX0, cellY0 } = withoutPlaza.ev.grid;
    expect(unseen[(48 - cellY0) * cols + 56 - cellX0]).toBe(0);
  });
});

describe('the landmark', () => {
  it('is found where its paving lies', () => {
    const p = detectPlaza(withPlaza.ev, withPlaza.reading.readings);
    expect(p).not.toBeNull();
    const { cellX0, cellY0 } = withPlaza.ev.grid;
    expect(p!.rotation).toBe(0);
    expect(p!.x + cellX0).toBe(50);
    expect(p!.y + cellY0).toBe(34);
    expect(p!.confidence).toBeGreaterThan(0.8);
  });

  it('is not found on a planet without one', () => {
    expect(detectPlaza(withoutPlaza.ev, withoutPlaza.reading.readings)).toBeNull();
  });
});

describe('the scanned planet template', () => {
  it('is a trusted planet whose grass, plaza and chunks follow the scan', () => {
    const run = withPlaza;
    const plaza = detectPlaza(run.ev, run.reading.readings);
    const planet = scannedPlanet(run.reading, plaza, 'Scanned');
    const t = planet.template;
    expect(isTrustedPlanet(t)).toBe(true);
    expect(planet.plaza).toEqual({ detected: true, confidence: plaza!.confidence, rotationInferred: true });
    expect(t.width % CHUNK_SIZE).toBe(0);
    expect(t.chunkGrid).toEqual({ origin: { x: 0, y: 0 }, columns: t.width / CHUNK_SIZE, rows: t.height / CHUNK_SIZE });
    // The template's cell (0, 0) is a lattice cell on a chunk line: the land starts in lattice chunk 1.
    const x0 = 16;
    const y0 = 16;
    expect(t.plaza).toMatchObject({ x: 50 - x0, y: 34 - y0, width: PLANET_PROFILE.landmark.width, height: PLANET_PROFILE.landmark.height });
    const ground = groundUnderRim(t.zones, planet.rimSand);
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const s = run.scene.ground[(y + y0) * run.scene.cols + x + x0]!;
        expect(isGrassZone(t.zones[y]![x]!)).toBe(s === GRASS);
        if (s === GRASS) continue;
        // The rim keeps the ground under it; the coast may differ by a cell.
        expect(t.zones[y]![x] === CellZone.Boundary || !isGrassZone(ground[y]![x]!)).toBe(true);
      }
    }
    const inferredUnderPlaza = planet.inferred.filter((i) => {
      const x = i % t.width;
      const y = Math.floor(i / t.width);
      return x >= t.plaza.x && x < t.plaza.x + t.plaza.width && y >= t.plaza.y && y < t.plaza.y + t.plaza.height;
    });
    expect(inferredUnderPlaza).toEqual([]);
    expect(planet.inferred.length).toBeGreaterThan(0);
    expect(ground.flat().filter(isLandZone).length).toBeGreaterThan(0);
  });

  it('places a missing landmark on the grass centre and flags it', () => {
    const planet = scannedPlanet(withoutPlaza.reading, null);
    const t = planet.template;
    expect(isTrustedPlanet(t)).toBe(true);
    expect(planet.plaza).toEqual({ detected: false, confidence: 0, rotationInferred: true });
    expect(t.plaza.width).toBe(PLANET_PROFILE.landmark.width);
    for (let y = t.plaza.y; y < t.plaza.y + t.plaza.height; y++) {
      for (let x = t.plaza.x; x < t.plaza.x + t.plaza.width; x++) expect(isGrassZone(t.zones[y]![x]!)).toBe(true);
    }
    // Near the island's centre (56, 48) in lattice cells, 16 cells before the template's origin.
    expect(Math.abs(t.plaza.x + t.plaza.width / 2 - 40)).toBeLessThanOrEqual(3);
    expect(Math.abs(t.plaza.y + t.plaza.height / 2 - 32)).toBeLessThanOrEqual(3);
  });
});

describe('the build-texture guard', () => {
  it('keeps a sand notch and a shadowed sand notch beside the grass as sand', () => {
    for (const r of [SAND_NOTCH, SHADOW_NOTCH]) for (const [x, y] of cellsOf(r)) expect(withoutPlaza.reading.ground[at(withoutPlaza, x, y)]).toBe(SAND);
  });

  it('is what keeps them: without it the blob and the profile turn them to grass', () => {
    const unguarded = readGround(withoutPlaza.ev, undefined, { blobTexture: 0, profileTexture: 0 });
    for (const r of [SAND_NOTCH, SHADOW_NOTCH]) for (const [x, y] of cellsOf(r)) expect(unguarded.ground[at(withoutPlaza, x, y)]).toBe(GRASS);
  });
});

describe('a partial scan', () => {
  it('still makes a planet and reports the cells no frame saw', () => {
    // Drop the south-east corner: the last two rows of frames in the last column.
    const run = scan(islandScene(), (p, all) => {
      const maxX = Math.max(...all.map((q) => q.x));
      const maxY = Math.max(...all.map((q) => q.y));
      return !(p.x === maxX && p.y >= maxY - 60);
    });
    const planet = scannedPlanet(run.reading, null);
    expect(isTrustedPlanet(planet.template)).toBe(true);
    expect(planet.unseen.length).toBeGreaterThan(0);
    expect(planet.unseen.length).toBeLessThan(planet.template.width * planet.template.height);
    expect(planet.unseen.length).toBeGreaterThan(scannedPlanet(withoutPlaza.reading, null).unseen.length);
  });
});

describe('scans that make no planet', () => {
  /** A reading of `cols` x `rows` cells whose grass is `grass`. */
  const reading = (cols: number, rows: number, grass: (x: number, y: number) => boolean): GroundReading => {
    const ground = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) ground[y * cols + x] = grass(x, y) ? GRASS : SEA;
    return { cols, rows, ground, inferred: new Uint8Array(cols * rows), unseen: new Uint8Array(cols * rows), readings: withoutPlaza.reading.readings };
  };

  it('refuse a scan without grass', () => {
    expect(() => scannedPlanet(reading(64, 64, () => false), null)).toThrow(ScanError);
    expect(() => scannedPlanet(reading(64, 64, () => false), null)).toThrow(expect.objectContaining({ reason: 'no-ground' }));
  });

  it('refuse land wider than the largest planet', () => {
    const wide = (PLANET_PROFILE.maxChunks + 1) * CHUNK_SIZE;
    expect(() => scannedPlanet(reading(wide + 32, 64, (x, y) => x >= 16 && x < 16 + wide && y >= 20 && y < 40), null)).toThrow(
      expect.objectContaining({ reason: 'too-large' }),
    );
  });

  it('refuse a scan whose frames span more than the evidence grid holds', () => {
    const lattice = testLattice(0, 0);
    const far = (SCAN_PROFILE.evidence.maxChunks + 1) * SCAN_PROFILE.chunk.width;
    expect(() => evidenceGrid(lattice, [{ x: 0, y: 0 }, { x: far, y: 0 }], W, H)).toThrow(expect.objectContaining({ reason: 'too-large' }));
  });

  it('make a planet without a landmark when no footprint fits on the grass', () => {
    const planet = scannedPlanet(reading(64, 64, (x, y) => x >= 20 && x < 30 && y >= 20 && y < 30), null);
    expect(planet.plaza).toBeNull();
    expect(planet.template.plaza.width).toBe(0);
    expect(isTrustedPlanet(planet.template)).toBe(true);
  });
});

describe('landmark variants', () => {
  const centreOf = (p: { x: number; y: number }, rotation: number) => {
    const { width, height } = PLANET_PROFILE.landmark;
    const [w, h] = rotation === 90 ? [height, width] : [width, height];
    return { x: p.x + w / 2, y: p.y + h / 2 };
  };

  it('fits the footprint over a smaller paving, centred on it', () => {
    const paving = { x: 52, y: 36, w: 17, h: 23 };
    const run = scan(islandScene({ plaza: paving }));
    const p = detectPlaza(run.ev, run.reading.readings)!;
    expect(p).not.toBeNull();
    expect(p.rotation).toBe(0);
    const c = centreOf({ x: p.x + run.ev.grid.cellX0, y: p.y + run.ev.grid.cellY0 }, p.rotation);
    expect(Math.abs(c.x - (paving.x + paving.w / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(c.y - (paving.y + paving.h / 2))).toBeLessThanOrEqual(0.5);
  });

  it('turns the footprint a quarter for a paving lying across', () => {
    const paving = { x: 44, y: 36, w: 27, h: 20 };
    const run = scan(islandScene({ plaza: paving }));
    const p = detectPlaza(run.ev, run.reading.readings)!;
    expect(p).toMatchObject({ rotation: 90, x: paving.x - run.ev.grid.cellX0, y: paving.y - run.ev.grid.cellY0 });
  });

  it('finds the paving where a build touches it', () => {
    const run = scan(islandScene({ plaza: PLAZA_AT, builds: [{ x: PLAZA_AT.x + PLAZA_AT.w, y: 40, w: 3, h: 4 }] }));
    const p = detectPlaza(run.ev, run.reading.readings)!;
    expect(p).toMatchObject({ rotation: 0, x: PLAZA_AT.x - run.ev.grid.cellX0, y: PLAZA_AT.y - run.ev.grid.cellY0 });
  });
});

it('gives a scanned planet the id the planet editor gives the same ground', () => {
  const planet = scannedPlanet(withoutPlaza.reading, null);
  const { cols, rows } = withoutPlaza.reading;
  const zones = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    const g = withoutPlaza.reading.ground[y * cols + x];
    return g === GRASS ? CellZone.Grass : g === SAND ? CellZone.Beach : CellZone.Void;
  }));
  const state = bareGridState({ id: 'canvas', name: { en: '' }, width: cols, height: rows, zones, plaza: { ...NO_PLANET_PLAZA } });
  const p = planet.template.plaza;
  const landmark = planetPlazaObject({ x: p.x + planet.frame.x0, y: p.y + planet.frame.y0 }, 0);
  state.objects.set(landmark.id, landmark);
  expect(sessionPlanet(state)!.template.id).toBe(planet.template.id);
});
