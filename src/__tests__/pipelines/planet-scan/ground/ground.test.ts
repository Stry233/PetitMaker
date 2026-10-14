import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, LANDMARKS, PLANET_PROFILE, ZONES } from '../../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { templateAnchor, planetLandmarkObject } from '../../../../core/model/landmarks';
import { isBuildableZone, isGrassZone, isLandZone, CellZone } from '../../../../core/game/zones';
import { isTrustedPlanet } from '../../../../core/model/planet-validate';
import { fitPalette, paletteLookup, readGround, type GroundReading } from '../../../../pipelines/planet-scan/ground/classify';
import { GRASS, PaletteSampler, SAND, SEA } from '../../../../pipelines/planet-scan/ground/color';
import { EvidenceAccumulator, evidenceGrid, reduceDeviation, type CellEvidence } from '../../../../pipelines/planet-scan/ground/evidence';
import { detectLandmarks } from '../../../../pipelines/planet-scan/ground/landmark';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { scannedPlanet } from '../../../../pipelines/planet-scan/to-template';
import { SHORE_MODEL, type ShoreModel } from '../../../../pipelines/planet-scan/ground/shore-model';
import { bareGridState } from '../../../../core/model/template';
import { groundUnderRim } from '../../../../core/model/shore';
import { sessionPlanet } from '../../../../editor/operations/planet-session';
import { ScanError } from '../../../../pipelines/planet-scan/errors';
import type { FramePosition } from '../../../../pipelines/planet-scan/track/scan-solve';
import {
  coastScene, COLOURS, islandScene, paintWorld, PLAZA_AT, SAND_NOTCH, scanPositions, SHADOW_NOTCH, testLattice, viewDeviation, viewTile,
  type CellRect, type Scene,
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
  const tiles = positions.map((p, k) => viewTile(world, p, { width: W, height: H }, k, (k % 5) / 4));
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

/** The anchor landmark read from a run, if any. */
const anchorOf = (run: Run) => detectLandmarks(run.ev, run.reading).find((l) => l.id === ANCHOR_LANDMARK.id);

/** Where a landmark at lattice cell (x, y) stands on a run's grid. */
const onGrid = (run: Run, x: number, y: number) => ({ x: x - run.ev.grid.cellX0, y: y - run.ev.grid.cellY0 });

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
  it('is read where its paving lies, by its outline since its structure is not recorded', () => {
    const p = anchorOf(withPlaza);
    expect(ANCHOR_LANDMARK.structure).toBeUndefined();
    expect(p).toMatchObject({ ...onGrid(withPlaza, PLAZA_AT.x, PLAZA_AT.y), placedBy: 'outline' });
    expect(p!.confidence).toBeGreaterThan(0.5);
  });

  it.each([[58, 30], [56.5, 40.5], [41.5, 30]])('moves with its paving, at (%s, %s) too', (x, y) => {
    const run = scan(islandScene({ plaza: { ...PLAZA_AT, x, y } }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, x, y));
  });

  it('takes in the building at its back where the paving covers only its front', () => {
    const { x, y, w, h } = PLAZA_AT;
    const run = scan(islandScene({ plaza: { x, y: y + 7, w, h: h - 7 }, builds: [{ x: x + 4, y, w: w - 8, h: 6 }] }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, x, y));
  });

  it('is read where the votes read its paving mostly as grass', () => {
    // A third of the paving in the paving's colour, the rest in the grass's.
    const run = scan(islandScene({ plaza: PLAZA_AT, pavingStripes: [COLOURS.grass, COLOURS.grass, COLOURS.paving] }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, PLAZA_AT.x, PLAZA_AT.y));
  });

  it('is read where a build touches its paving', () => {
    const run = scan(islandScene({ plaza: PLAZA_AT, builds: [{ x: PLAZA_AT.x + PLAZA_AT.w, y: 40, w: 3, h: 4 }] }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, PLAZA_AT.x, PLAZA_AT.y));
  });

  it('is not read on a planet without one', () => {
    expect(anchorOf(withoutPlaza)).toBeUndefined();
  });

  it('is read at its footprint where a roof in the grass\'s colour covers its back', () => {
    const { x, y, w, h } = PLAZA_AT;
    const run = scan(islandScene({ plaza: { x, y: y + 7, w, h: h - 7 }, roofs: [{ x: x + 4, y, w: w - 8, h: 7 }] }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, x, y));
  });

  it('is read centred on a paving smaller than its footprint', () => {
    const { x, y, w, h } = PLAZA_AT;
    const run = scan(islandScene({ plaza: { x: x + 2, y: y + 2, w: w - 4, h: h - 4 } }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, x, y));
  });

  it('is not pulled by roads along its sides', () => {
    // Roads touch its west and south sides and pass a cell from its north and east ones.
    const { x, y, w, h } = PLAZA_AT;
    const roads = [
      { x: x - 2, y: y - 3, w: 2, h: h + 5 }, { x: x - 2, y: y - 3, w: w + 5, h: 2 },
      { x: x + w + 1, y: y - 3, w: 2, h: h + 5 }, { x: x - 2, y: y + h, w: w + 5, h: 2 },
    ];
    const run = scan(islandScene({ plaza: PLAZA_AT, roads }));
    expect(anchorOf(run)).toMatchObject(onGrid(run, x, y));
  });

  it('is not read on a road network over grass without one', () => {
    const roads = [
      ...[34, 46, 58].map((y) => ({ x: 30, y, w: 52, h: 2 })),
      ...[36, 50, 64].map((x) => ({ x, y: 24, w: 2, h: 48 })),
    ];
    expect(anchorOf(scan(islandScene({ roads })))).toBeUndefined();
  });
});

describe('the station', () => {
  const station = LANDMARKS.find((l) => l.ground === 'coast')!;
  const stationOf = (run: Run) => detectLandmarks(run.ev, run.reading).find((l) => l.id === station.id);
  const structure = station.structure!;
  /** The coast with the station's deck drawn as its recorded structure for a footprint at (x, y):
   *  its body only, which starts 5.6 cells in, south of the gangway. The deck's north edge is not
   *  read, and a deck drawn up to this beach would read as land. */
  const recordedDeck = (x: number, y: number, north = 5.6) => coastScene({
    x: x + structure.west, y: y + north, w: station.width - structure.west - structure.east, h: station.height - north - structure.south,
  });
  // A deck two cells inside the footprint's sides, unlike the recorded structure, reaching past its south edge.
  const deckUnder = (x: number) => coastScene({ x: x + 2, y: 65, w: station.width - 4, h: 20 });

  it.each([[41.5, 58], [63, 58.5]])('is laid by its recorded structure at (%s, %s)', (x, y) => {
    const run = scan(recordedDeck(x, y));
    expect(stationOf(run)).toMatchObject({ ...onGrid(run, x, y), placedBy: 'structure' });
  });

  it.each([41.5, 63])('falls back to the contrast fit and says so over a deck of another size, at x %s', (x) => {
    const run = scan(deckUnder(x));
    expect(run.reading.ground[at(run, Math.ceil(x) + 6, 70)]).toBe(SEA);
    const p = stationOf(run)!;
    expect(p.placedBy).toBe('contrast');
    expect(p.x).toBe(x - run.ev.grid.cellX0);
    // The contrast fit stands as far south as the ground allows: the footprint's first half row on
    // the last row read as land under its columns.
    const { cols, rows, ground } = run.reading;
    const reads = (r: number, g: number) => {
      for (let c = Math.floor(p.x); c < Math.ceil(p.x + station.width); c++) if (ground[r * cols + c] === g) return true;
      return false;
    };
    const lastGrass = Array.from({ length: rows }, (_, r) => r).filter((r) => reads(r, GRASS)).pop()!;
    const firstSea = Array.from({ length: rows }, (_, r) => r).find((r) => r > lastGrass && reads(r, SEA))!;
    expect(p.y).toBe(firstSea - 0.5);
    // The coast scene's beach ends at row 62; the reading's coast lies within two cells of it.
    expect(Math.abs(firstSea + run.ev.grid.cellY0 - 62)).toBeLessThanOrEqual(2);
  });

  it('is not read on a plain coast, nor on an island scan without one', () => {
    expect(stationOf(scan(coastScene(null)))).toBeUndefined();
    expect(stationOf(withPlaza)).toBeUndefined();
  });

  it('stands on the scanned planet, which widens to hold it', () => {
    const plain = scannedPlanet(scan(coastScene(null)).reading, []);
    const run = scan(deckUnder(41.5));
    const planet = scannedPlanet(run.reading, detectLandmarks(run.ev, run.reading));
    expect(isTrustedPlanet(planet.template)).toBe(true);
    expect(planet.template.landmarks.map((l) => l.id)).toContain(station.id);
    expect(planet.unplaced).not.toContain(station.id);
    expect(planet.template.height).toBeGreaterThan(plain.template.height);
    expect(planet.template.id).not.toBe(plain.template.id);
    const read = stationOf(run)!;
    expect(planet.template.landmarks.find((l) => l.id === station.id)).toMatchObject({ x: read.x - planet.frame.x0, y: read.y - planet.frame.y0 });
  });

  it('is left off, and reported, when it would widen the frame past the largest planet', () => {
    // Grass spanning the largest planet's chunks across, with a station read past its east end.
    const cols = (PLANET_PROFILE.maxChunks + 2) * CHUNK_SIZE;
    const ground = new Uint8Array(cols * 64);
    for (let y = 20; y < 40; y++) for (let x = CHUNK_SIZE; x < (PLANET_PROFILE.maxChunks + 1) * CHUNK_SIZE; x++) ground[y * cols + x] = GRASS;
    const reading = { cols, rows: 64, ground, inferred: new Uint8Array(cols * 64), unseen: new Uint8Array(cols * 64), readings: withoutPlaza.reading.readings };
    const without = scannedPlanet(reading, []);
    expect(without.frame.cols).toBe(PLANET_PROFILE.maxChunks);
    const past = { id: station.id, x: (PLANET_PROFILE.maxChunks + 1) * CHUNK_SIZE + 2, y: 30, confidence: 1, placedBy: 'structure' as const };
    const planet = scannedPlanet(reading, [past]);
    expect(planet.frame.cols).toBe(PLANET_PROFILE.maxChunks);
    expect(planet.template.landmarks.map((l) => l.id)).not.toContain(station.id);
    expect(planet.unplaced).toContain(station.id);
    expect(planet.tooFar).toEqual([station.id]);
    expect(planet.template.id).toBe(without.template.id);
    expect(without.tooFar).toEqual([]);
    expect(planet.blocked).toEqual([]);
  });

  describe('where the planet cannot hold it', () => {
    // Grass with sand round it on open sea, and the plaza read at its centre.
    const cols = 4 * CHUNK_SIZE, rows = 4 * CHUNK_SIZE;
    const ground = new Uint8Array(cols * rows);
    const rim = (x: number, y: number) => x < 12 || x >= cols - 12 || y < 12 || y >= rows - 12;
    for (let y = 8; y < rows - 8; y++) for (let x = 8; x < cols - 8; x++) ground[y * cols + x] = rim(x, y) ? SAND : GRASS;
    const reading = { cols, rows, ground, inferred: new Uint8Array(cols * rows), unseen: new Uint8Array(cols * rows), readings: withoutPlaza.reading.readings };
    const plaza = { id: ANCHOR_LANDMARK.id, x: 30, y: 30, confidence: 1, placedBy: 'contrast' as const };
    const without = scannedPlanet(reading, [plaza]);

    it.each([
      ['across the plaza', { x: 32, y: 34 }],
      ['inland, on grass', { x: 14, y: 14 }],
    ])('is left off and reported when read %s', (_, at) => {
      const planet = scannedPlanet(reading, [plaza, { id: station.id, ...at, confidence: 1, placedBy: 'structure' as const }]);
      expect(isTrustedPlanet(planet.template)).toBe(true);
      expect(planet.template.landmarks.map((l) => l.id)).toEqual([ANCHOR_LANDMARK.id]);
      expect(planet.blocked).toEqual([station.id]);
      expect(planet.tooFar).toEqual([]);
      expect(planet.unplaced).toContain(station.id);
      expect(planet.template.id).toBe(without.template.id);
    });
  });
});

describe('the scanned planet template', () => {
  it('is a trusted planet whose grass, plaza and chunks follow the scan', () => {
    const run = withPlaza;
    const read = detectLandmarks(run.ev, run.reading);
    const plaza = read.find((l) => l.id === ANCHOR_LANDMARK.id);
    const planet = scannedPlanet(run.reading, read, 'Scanned');
    const t = planet.template;
    expect(isTrustedPlanet(t)).toBe(true);
    expect(planet.plaza).toEqual({ detected: true, confidence: plaza!.confidence, rotationInferred: true });
    expect(t.width % CHUNK_SIZE).toBe(0);
    expect(t.chunkGrid).toEqual({ origin: { x: 0, y: 0 }, columns: t.width / CHUNK_SIZE, rows: t.height / CHUNK_SIZE });
    // The template's cell (0, 0) is a lattice cell on a chunk line: the land starts in lattice chunk 1.
    const x0 = 16;
    const y0 = 16;
    expect(templateAnchor(t)!).toMatchObject({ x: PLAZA_AT.x - x0, y: PLAZA_AT.y - y0, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height });
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
      const anchor = templateAnchor(t)!;
      return x >= anchor.x && x < anchor.x + anchor.width && y >= anchor.y && y < anchor.y + anchor.height;
    });
    expect(inferredUnderPlaza).toEqual([]);
    expect(planet.inferred.length).toBeGreaterThan(0);
    expect(ground.flat().filter(isLandZone).length).toBeGreaterThan(0);
  });

  it('places a missing landmark on the grass centre and flags it', () => {
    const planet = scannedPlanet(withoutPlaza.reading, []);
    const t = planet.template;
    expect(isTrustedPlanet(t)).toBe(true);
    expect(planet.plaza).toEqual({ detected: false, confidence: 0, rotationInferred: true });
    expect(templateAnchor(t)!.width).toBe(ANCHOR_LANDMARK.width);
    for (let y = templateAnchor(t)!.y; y < templateAnchor(t)!.y + templateAnchor(t)!.height; y++) {
      for (let x = templateAnchor(t)!.x; x < templateAnchor(t)!.x + templateAnchor(t)!.width; x++) expect(isGrassZone(t.zones[y]![x]!)).toBe(true);
    }
    // Near the island's centre (56, 48) in lattice cells, 16 cells before the template's origin.
    expect(Math.abs(templateAnchor(t)!.x + templateAnchor(t)!.width / 2 - 40)).toBeLessThanOrEqual(3);
    expect(Math.abs(templateAnchor(t)!.y + templateAnchor(t)!.height / 2 - 32)).toBeLessThanOrEqual(3);
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

describe('a shaded beach', () => {
  // A beach slope facing away from the light reads dark; a shore model fooled by it calls every
  // cell it decides sea, and the beach still stands where it lies deeper than the drawn beach reaches.
  const allSea: ShoreModel = { features: SHORE_MODEL.features, predict: () => 0 };
  const beach: CellRect = { x: 38, y: 76, w: 32, h: 8 };
  const run = scan(islandScene({ sand: [beach] }));

  it('keeps land deeper inside the observed coast than the drawn beach reaches', () => {
    const reading = readGround(run.ev, allSea);
    // The synthetic beach is drawn to the land's edge, so the observed coast lies on the scene's.
    const reach = SCAN_PROFILE.ground.beachReach - 1;
    const { ground, cols } = run.scene;
    const deep = cellsOf(beach).filter(([x, y]) => {
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (ground[(y + dy) * cols + x + dx] === SEA) return false;
      return true;
    });
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.filter(([x, y]) => reading.ground[at(run, x, y)] === SEA)).toEqual([]);
  });
});

describe('inland water', () => {
  // Only grass takes terrain and builds, so water standing inland lies on grass, whether the grass
  // closes round it or a beach opens beside it.
  const inside: CellRect = { x: 50, y: 50, w: 8, h: 6 };
  const onBeach: CellRect = { x: 72, y: 64, w: 8, h: 8 };
  const run = scan(islandScene({ water: [inside, onBeach], sand: [{ x: 66, y: 72, w: 20, h: 10 }] }));

  it('rests on grass being the only buildable zone', () => {
    const zones = Object.keys(ZONES).map(Number) as CellZone[];
    const grass = zones.filter((z) => isGrassZone(z));
    expect(grass.length).toBeGreaterThan(0);
    expect(zones.filter((z) => isBuildableZone(z))).toEqual(grass);
  });

  it('reads the grass under water the grass encloses', () => {
    for (const [x, y] of cellsOf(inside)) expect(run.reading.ground[at(run, x, y)]).toBe(GRASS);
  });

  it('reads the grass under water that opens onto the beach, and flags it inferred', () => {
    for (const [x, y] of cellsOf(onBeach)) {
      expect(run.reading.ground[at(run, x, y)]).toBe(GRASS);
      expect(run.reading.inferred[at(run, x, y)]).toBe(1);
    }
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
    const planet = scannedPlanet(run.reading, []);
    expect(isTrustedPlanet(planet.template)).toBe(true);
    expect(planet.unseen.length).toBeGreaterThan(0);
    expect(planet.unseen.length).toBeLessThan(planet.template.width * planet.template.height);
    expect(planet.unseen.length).toBeGreaterThan(scannedPlanet(withoutPlaza.reading, []).unseen.length);
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
    expect(() => scannedPlanet(reading(64, 64, () => false), [])).toThrow(ScanError);
    expect(() => scannedPlanet(reading(64, 64, () => false), [])).toThrow(expect.objectContaining({ reason: 'no-ground' }));
  });

  it('refuse land wider than the largest planet', () => {
    const wide = (PLANET_PROFILE.maxChunks + 1) * CHUNK_SIZE;
    expect(() => scannedPlanet(reading(wide + 32, 64, (x, y) => x >= 16 && x < 16 + wide && y >= 20 && y < 40), [])).toThrow(
      expect.objectContaining({ reason: 'too-large' }),
    );
  });

  it('refuse a scan whose frames span more than the evidence grid holds', () => {
    const lattice = testLattice(0, 0);
    const far = (SCAN_PROFILE.evidence.maxChunks + 1) * SCAN_PROFILE.chunk.width;
    expect(() => evidenceGrid(lattice, [{ x: 0, y: 0 }, { x: far, y: 0 }], W, H)).toThrow(expect.objectContaining({ reason: 'too-large' }));
  });

  it('make a planet without a landmark when no footprint fits on the grass', () => {
    const planet = scannedPlanet(reading(64, 64, (x, y) => x >= 20 && x < 30 && y >= 20 && y < 30), []);
    expect(planet.plaza).toBeNull();
    expect(templateAnchor(planet.template)).toBeUndefined();
    expect(isTrustedPlanet(planet.template)).toBe(true);
  });

  it('leave every landmark it did not read or lay for the person to place', () => {
    const none = scannedPlanet(reading(64, 64, (x, y) => x >= 20 && x < 30 && y >= 20 && y < 30), []);
    expect(none.unplaced).toEqual(LANDMARKS.filter((l) => l.editorPlaceable).map((l) => l.id));
    const run = withPlaza;
    const planet = scannedPlanet(run.reading, detectLandmarks(run.ev, run.reading));
    expect(planet.unplaced).toEqual(LANDMARKS.filter((l) => l.editorPlaceable && !l.anchor).map((l) => l.id));
    expect(detectLandmarks(run.ev, run.reading).map((l) => l.id)).toEqual([ANCHOR_LANDMARK.id]);
  });
});

it('gives a scanned planet the id the planet editor gives the same ground', () => {
  const planet = scannedPlanet(withoutPlaza.reading, []);
  const { cols, rows } = withoutPlaza.reading;
  const zones = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    const g = withoutPlaza.reading.ground[y * cols + x];
    return g === GRASS ? CellZone.Grass : g === SAND ? CellZone.Beach : CellZone.Void;
  }));
  const state = bareGridState({ id: 'canvas', name: { en: '' }, width: cols, height: rows, zones, landmarks: []});
  const p = templateAnchor(planet.template)!;
  const landmark = planetLandmarkObject(ANCHOR_LANDMARK, { x: p.x + planet.frame.x0, y: p.y + planet.frame.y0 }, 0);
  state.objects.set(landmark.id, landmark);
  expect(sessionPlanet(state)!.template.id).toBe(planet.template.id);
});
