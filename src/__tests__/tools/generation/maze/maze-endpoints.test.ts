/*
 * The maze's two ends: what they promise, and the one thing they do not.
 *
 * The carve is a spanning tree, so exactly one route runs between any two corridors. That says nothing
 * about the ground the maze is standing on. The probe below asks the only question that settles it: can
 * a walker leave by one end, stay out of the maze, and arrive at the other?
 *
 * The guarantee is made for the default ends, which put the exit inside the maze: the panel's default
 * pair (`defaultMazeGates`, in from the west edge and out at the middle) and the generator's own (in
 * from the edge, out at the plaza). Arriving at an end inside means entering, so no route skips the
 * maze. Two ends a user places on the rim carry no such guarantee: the border ring walls the maze so the
 * gates are its only ways in, but two holes in the boundary of one simply-connected shape are two doors
 * onto the same outside, and a walker steps out of one, round the rectangle, and into the other.
 */
import { describe, it, expect } from 'vitest';
import { defaultEnds, resolveEnd, routeBetween, type MazeEnd, type MazeField } from '../../../../tools/generation/maze/maze-endpoints';
import { readFileSync } from 'node:fs';
import { defaultMazeGates, generateMaze, mazeFootprint } from '../../../../tools/generation/maze/maze-generator';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { objectRect } from '../../../../state/object-geometry';
import { createGrid, getCell } from '../../../../core/model/grid-model';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { isBuildableZone } from '../../../../core/game/zones';
import { realSurface, surfaceElevation } from '../../../../core/domain/terrain/terrain-surface';
import { TerrainType, type Command, type GridState, type MacroCoord, type MapTemplate } from '../../../../core/model/types';

/** How many cells the walk between two ends visits, both ends included, or null with no route. */
const walkLength = (field: MazeField, a: MazeEnd, b: MazeEnd): number | null => routeBetween(field, a, b)?.length ?? null;

/** The real shipped map: a grass disc inside beach inside sea, with the locked plaza in the middle. */
function islandState(file = 'hexia.json'): GridState {
  const template = JSON.parse(readFileSync(`src/config/maps/${file}`, 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map();
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

/**
 * The surface a person could stand on here, or null for somewhere they could not be. Taken from the
 * engine rather than invented: `agent/tools/quality.ts` and `placement/analysis.ts` both walk the same
 * ground, which is `isBuildableZone` (grass, so not the sand rim and not the sea) with no water on it.
 * `realSurface` is the only correct read of the height — a Γ patch is cosmetic above its base, so a raw
 * `terrain.elevation` would see a fillet as a full block and call walkable ground a wall.
 */
function standing(state: GridState, x: number, y: number): number | null {
  const cell = getCell(state.cells, x, y);
  if (!cell || !isBuildableZone(cell.zone)) return null;
  if (realSurface(cell.terrain)?.type === TerrainType.Water) return null;
  return surfaceElevation(cell.terrain);
}

const STEPS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * A route from `from` to `to` that never sets foot inside the maze's rectangle, or null if none exists.
 * A step needs both cells standing at the same elevation, which is what makes a raised wall a wall: there
 * is no ramp in a maze, so a walk that starts on the ground stays on it. Both gates sit on the rectangle,
 * so they are the two cells of it the walk may use: it has to step straight out of `from` and back into
 * `to`, and everything else within the rectangle is the maze.
 */
function routeAroundOutside(
  state: GridState, fp: { origin: MacroCoord; dims: { mazeW: number; mazeH: number } }, from: MacroCoord, to: MacroCoord,
): MacroCoord[] | null {
  const { origin, dims } = fp;
  const inMaze = (x: number, y: number): boolean =>
    x >= origin.x && x < origin.x + dims.mazeW && y >= origin.y && y < origin.y + dims.mazeH;
  const key = (c: MacroCoord): string => `${c.x},${c.y}`;
  const goal = key(to);
  const prev = new Map<string, MacroCoord | null>([[key(from), null]]);
  const queue: MacroCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    if (key(at) === goal) {
      const route: MacroCoord[] = [];
      for (let c: MacroCoord | null | undefined = at; c; c = prev.get(key(c))) route.push(c);
      return route.reverse();
    }
    const here = standing(state, at.x, at.y);
    if (here === null) continue;
    for (const [dx, dy] of STEPS) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (prev.has(key(next))) continue;
      if (standing(state, next.x, next.y) !== here) continue;
      if (inMaze(next.x, next.y) && key(next) !== goal) continue;
      prev.set(key(next), at);
      queue.push(next);
    }
  }
  return null;
}

/** A square of grass clear of the plaza, which is how the feature is used: a maze painted into a region. */
function regionCells(x0 = 30, y0 = 20, x1 = 70, y1 = 60): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

/** Lay a maze on the map through the live rule registry, one stroke group, at the panel's default ends. */
function mazeOnIsland(seed: number, region: MacroCoord[] | null) {
  const state = islandState();
  const exec = makeExecutor(state);
  const start = exec.beginStroke();
  const fp = mazeFootprint(state, region, 1)!;
  const result = generateMaze({ state, execute: (c: Command) => exec.execute(c) }, {
    seed: seed, maxElevation: 3, corridorWidth: 1, region: region, mazeGates: defaultMazeGates(fp),
  });
  const violations = start.commit();
  return { state, fp, violations, ...result };
}

/** The cells of the locked plaza on the island. */
function plazaCells(state: GridState): MacroCoord[] {
  const plaza: MacroCoord[] = [];
  for (const obj of state.objects.values()) {
    if (!obj.locked) continue;
    const rect = objectRect(obj);
    for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y++) {
      for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x++) plaza.push({ x, y });
    }
  }
  return plaza;
}

/** A region round the plaza, so the maze's rectangle holds it. */
function aroundPlaza(state: GridState): MacroCoord[] {
  const plaza = plazaCells(state);
  const cx = Math.round(plaza.reduce((s, c) => s + c.x, 0) / plaza.length);
  const cy = Math.round(plaza.reduce((s, c) => s + c.y, 0) / plaza.length);
  return regionCells(cx - 20, cy - 20, cx + 20, cy + 20);
}

describe('Maze endpoints: no walk-around', () => {
  it('gives no walkable route that skips the maze between the panel\'s default ends', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const { state, fp, gates, violations } = mazeOnIsland(seed, regionCells());
      expect(violations, `seed ${seed} post-stroke violations`).toEqual([]);
      expect(gates.entrance).not.toBeNull();
      expect(gates.exit).not.toBeNull();

      const around = routeAroundOutside(state, fp, gates.entrance!, gates.exit!);
      const shown = around?.slice(0, 8).map(c => `(${c.x},${c.y})`).join(' ');
      expect(around, `seed ${seed}: walked around the maze in ${around?.length} steps: ${shown}...`).toBeNull();
    }
  });

  it('and none between the generator\'s own ends, in from the edge and out at the plaza', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const state = islandState();
      const region = aroundPlaza(state);
      const exec = makeExecutor(state);
      const start = exec.beginStroke();
      const fp = mazeFootprint(state, region, 1)!;
      const { gates } = generateMaze({ state, execute: (c: Command) => exec.execute(c) }, { seed, maxElevation: 3, corridorWidth: 1, region });
      expect(start.commit(), `seed ${seed} post-stroke violations`).toEqual([]);
      expect(gates.entrance).not.toBeNull();
      expect(gates.exit).not.toBeNull();
      expect(routeAroundOutside(state, fp, gates.entrance!, gates.exit!), `seed ${seed}`).toBeNull();
    }
  });

  // Why the guarantee holds: the border ring seals the maze, so the only cell of it a walker outside can
  // step into is the way in.
  it('is entered only at its way in', () => {
    const { state, fp, gates } = mazeOnIsland(1, regionCells());
    const { origin: o, dims: d } = fp;
    const inMaze = (x: number, y: number): boolean => x >= o.x && x < o.x + d.mazeW && y >= o.y && y < o.y + d.mazeH;
    const waysIn: string[] = [];
    for (let y = o.y; y < o.y + d.mazeH; y++) for (let x = o.x; x < o.x + d.mazeW; x++) {
      const here = standing(state, x, y);
      if (here === null) continue;
      if (STEPS.some(([dx, dy]) => !inMaze(x + dx, y + dy) && standing(state, x + dx, y + dy) === here)) waysIn.push(`${x},${y}`);
    }
    expect(waysIn).toEqual([`${gates.entrance!.x},${gates.entrance!.y}`]);
  });
});

/** The field as the finished map shows it, which is the view the interface takes: a walker's ground
 *  rather than the generator's own lattice. Both go through `maze-endpoints`, which is the point. */
function fieldOf(state: GridState, fp: { origin: MacroCoord; dims: { mazeW: number; mazeH: number } }): MazeField {
  return {
    origin: fp.origin,
    dims: fp.dims,
    walkable: (x, y) => standing(state, x, y) === 0,
  };
}

/** Vertices and 4-adjacency edges over everything a walker can stand on inside the maze. */
function graph(state: GridState, fp: { origin: MacroCoord; dims: { mazeW: number; mazeH: number } }) {
  const { origin: o, dims: d } = fp;
  const cells: MacroCoord[] = [];
  for (let y = o.y; y < o.y + d.mazeH; y++) {
    for (let x = o.x; x < o.x + d.mazeW; x++) if (standing(state, x, y) === 0) cells.push({ x, y });
  }
  const inSet = new Set(cells.map(c => `${c.x},${c.y}`));
  let edges = 0;
  for (const c of cells) {
    if (inSet.has(`${c.x + 1},${c.y}`)) edges++;
    if (inSet.has(`${c.x},${c.y + 1}`)) edges++;
  }
  // Connectivity, from any one of them.
  const seen = new Set([`${cells[0]!.x},${cells[0]!.y}`]);
  const queue = [cells[0]!];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const [dx, dy] of STEPS) {
      const k = `${at.x + dx},${at.y + dy}`;
      if (!inSet.has(k) || seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: at.x + dx, y: at.y + dy });
    }
  }
  return { vertices: cells.length, edges, connected: seen.size === cells.length };
}

describe('Maze endpoints', () => {
  /**
   * The guarantee, and it is the one the default relies on: with an end inside the maze, entering is
   * the only way to arrive, and the carve's spanning tree makes that route unique. A tree is exactly
   * "one route between any two of its cells", so what is asserted is that the maze plus its one hole
   * is one — connected, with a vertex more than it has edges.
   */
  it('leaves exactly one route from the way in to a destination inside', () => {
    const state = islandState();
    const region = regionCells();
    const exec = makeExecutor(state);
    const start = exec.beginStroke();
    const fp = mazeFootprint(state, region, 1)!;
    const { gates } = generateMaze({ state, execute: (c: Command) => exec.execute(c) }, {
      seed: 3, maxElevation: 3, corridorWidth: 1, region: region, mazeGates: {
      entrance: { x: fp.origin.x, y: fp.origin.y + (fp.dims.mazeH >> 1) },
      exit: { x: fp.origin.x + (fp.dims.mazeW >> 1), y: fp.origin.y + (fp.dims.mazeH >> 1) },
    } });
    expect(start.commit()).toEqual([]);

    const field = fieldOf(state, fp);
    const walk = walkLength(field, { cell: gates.entrance!, kind: 'hole' }, { cell: gates.exit!, kind: 'target' });
    expect(walk).not.toBeNull();
    expect(walk!).toBeGreaterThan(2);

    const g = graph(state, fp);
    expect(g.connected).toBe(true);
    // A connected graph with V-1 edges is a tree: one route, and no second one.
    expect(g.edges).toBe(g.vertices - 1);
  });

  /**
   * The answer is always there to show. The carve is a spanning tree, so the route between the two
   * ends is unique and does not have to be searched for — and it exists at every corridor width,
   * one-wide included, which is why the answer is a drape rather than a road: a road's flat trait
   * refuses a corridor cell with wall below or right of it, which in a maze is most of them, and
   * on the default one-wide maze it paved nothing at all. A route that is drawn has to be the
   * route, so this holds it against the walk the readout reports rather than against itself.
   */
  it('finds the one route, at a wide corridor and at the one-wide default alike', () => {
    for (const cw of [1, 3]) {
      const state = makeState(28, 28);
      const region: MacroCoord[] = [];
      for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) region.push({ x, y });
      const exec = makeExecutor(state);
      const start = exec.beginStroke();
      const fp = mazeFootprint(state, region, cw)!;
      const { gates } = generateMaze({ state, execute: (c: Command) => exec.execute(c) }, { seed: 11, maxElevation: 3, corridorWidth: cw, region: region });
      start.commit();

      const field = fieldOf(state, fp);
      const entrance: MazeEnd = { cell: gates.entrance!, kind: 'hole' };
      const exit: MazeEnd = { cell: gates.exit!, kind: 'hole' };

      const route = routeBetween(field, entrance, exit);
      expect(route, `route exists (cw ${cw})`).not.toBeNull();
      // The route runs hole to hole through edge neighbours, both ends included.
      expect(route![0]).toEqual(exit.cell);
      expect(route![route!.length - 1]).toEqual(entrance.cell);
      for (let i = 1; i < route!.length; i++) {
        expect(Math.abs(route![i]!.x - route![i - 1]!.x) + Math.abs(route![i]!.y - route![i - 1]!.y)).toBe(1);
      }
      // Every cell of it is ground a walker can stand on, or one of the two holes.
      const holes = new Set([`${entrance.cell.x},${entrance.cell.y}`, `${exit.cell.x},${exit.cell.y}`]);
      for (const c of route!) {
        expect(`walkable:${field.walkable(c.x, c.y) || holes.has(`${c.x},${c.y}`)}`).toBe('walkable:true');
      }
    }
  });

  /**
   * The ends are recipe inputs: the carve grows out from the entrance, so asking for a different
   * way in at the same seed answers with a different maze, not the same corridors with a new hole.
   */
  it('reshapes the maze when the entrance moves, at the same seed', () => {
    const carve = (entrance: MacroCoord): string => {
      const state = makeState(28, 28);
      const region: MacroCoord[] = [];
      for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) region.push({ x, y });
      const exec = makeExecutor(state);
      const fp = mazeFootprint(state, region, 1)!;
      generateMaze({ state, execute: (c: Command) => exec.execute(c) }, { seed: 11, maxElevation: 3, corridorWidth: 1, region: region, mazeGates: {
        entrance, exit: { x: fp.origin.x + fp.dims.mazeW - 1, y: fp.origin.y + (fp.dims.mazeH >> 1) },
      } });
      let walls = '';
      for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) walls += state.cells[y]![x]!.terrain ? '#' : '.';
      return walls;
    };
    const a = carve({ x: 2, y: 2 });
    const b = carve({ x: 2, y: 24 });
    expect(a).not.toBe(b);
  });

  /**
   * The default is the longest walk, where there is no plaza to head for. Checked against every
   * other pair of ways in the maze offers, which is what "longest" has to mean.
   */
  it('defaults to the longest walk the maze holds when nothing is there to reach', () => {
    const state = makeState(28, 28);
    const region: MacroCoord[] = [];
    for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) region.push({ x, y });
    const exec = makeExecutor(state);
    const start = exec.beginStroke();
    const fp = mazeFootprint(state, region, 1)!;
    const { gates } = generateMaze({ state, execute: (c: Command) => exec.execute(c) }, { seed: 11, maxElevation: 3, corridorWidth: 1, region: region });
    start.commit();

    const field = fieldOf(state, fp);
    const chosen = walkLength(field, { cell: gates.entrance!, kind: 'hole' }, { cell: gates.exit!, kind: 'hole' })!;
    expect(chosen).toBeGreaterThan(0);

    // Every other pair of places a hole could have been cut, measured the same way. The two that
    // were chosen are already cut, so the field sees them as walkable and the rest as wall — which
    // is exactly how a candidate pair is measured from a hole that is not cut yet.
    // A ring cell a hole can be cut in is one a drop there resolves to itself.
    const { origin: o, dims: d } = field;
    const ring: MacroCoord[] = [];
    for (let x = o.x; x < o.x + d.mazeW; x++) ring.push({ x, y: o.y }, { x, y: o.y + d.mazeH - 1 });
    for (let y = o.y + 1; y < o.y + d.mazeH - 1; y++) ring.push({ x: o.x, y }, { x: o.x + d.mazeW - 1, y });
    const holes = ring.filter((c) => {
      const end = resolveEnd(field, c);
      return end?.kind === 'hole' && end.cell.x === c.x && end.cell.y === c.y;
    });
    expect(holes.length).toBeGreaterThan(2);
    for (const a of holes) {
      for (const b of holes) {
        if (a === b) continue;
        const walk = walkLength(field, { cell: a, kind: 'hole' }, { cell: b, kind: 'hole' });
        if (walk !== null) expect(walk).toBeLessThanOrEqual(chosen);
      }
    }
  });

  /**
   * A destination is reached without being built on. The plaza is unbuildable, so the maze routes
   * around it and the end is the corridor touching its edge — which is also why the plaza makes a
   * better default than an edge: arriving somewhere means something.
   */
  it('puts the destination on the corridor touching the plaza, and builds nothing on it', () => {
    const state = islandState();
    // A region around the square itself, so the plaza is inside the maze's own rectangle. The
    // square is an object on grass rather than a zone, so its
    // footprint is what both this test and the generator read.
    const plaza = plazaCells(state);
    expect(plaza.length).toBeGreaterThan(0);
    const square = new Set(plaza.map(c => `${c.x},${c.y}`));
    const region = aroundPlaza(state);

    const exec = makeExecutor(state);
    const start = exec.beginStroke();
    const { gates } = generateMaze({ state, execute: (c: Command) => exec.execute(c) }, { seed: 5, maxElevation: 3, corridorWidth: 1, region: region });
    expect(start.commit()).toEqual([]);

    const exit = gates.exit!;
    expect(getCell(state.cells, exit.x, exit.y)?.terrain ?? null).toBeNull();
    const touchesSquare = STEPS.some(([dx, dy]) => square.has(`${exit.x + dx},${exit.y + dy}`));
    expect(touchesSquare).toBe(true);
    expect(square.has(`${exit.x},${exit.y}`)).toBe(false);
    // And the way in is a hole in the boundary, not a second destination.
    const fp = mazeFootprint(state, region, 1)!;
    const onRing = gates.entrance!.x === fp.origin.x || gates.entrance!.y === fp.origin.y
      || gates.entrance!.x === fp.origin.x + fp.dims.mazeW - 1
      || gates.entrance!.y === fp.origin.y + fp.dims.mazeH - 1;
    expect(onRing).toBe(true);
  });

  /** Two ends dropped next to each other give a two-cell walk. It is a legal pair rather than a
   *  refused one: a rule nobody was told about is worse than a readout they can see. */
  it('reads a two-cell walk for two ends dropped side by side', () => {
    const field: MazeField = {
      origin: { x: 0, y: 0 },
      dims: { mazeW: 5, mazeH: 5 },
      walkable: (x, y) => x > 0 && y > 0 && x < 4 && y < 4,
    };
    const walk = walkLength(field, { cell: { x: 1, y: 1 }, kind: 'target' }, { cell: { x: 2, y: 1 }, kind: 'target' });
    expect(walk).toBe(2);
  });

  /** The plaza default needs a plaza; with none, `defaultEnds` gives two holes rather than nothing. */
  it('falls back to two ways in where nothing is there to reach', () => {
    const field: MazeField = {
      origin: { x: 0, y: 0 },
      dims: { mazeW: 7, mazeH: 7 },
      walkable: (x, y) => x > 0 && y > 0 && x < 6 && y < 6,
    };
    const ends = defaultEnds(field);
    expect(ends.entrance?.kind).toBe('hole');
    expect(ends.exit?.kind).toBe('hole');
    expect(ends.entrance!.cell).not.toEqual(ends.exit!.cell);
  });

  /**
   * The walk always exists. On the real map the maze's rectangle covers sea and sand, so the
   * walkable cells are several disconnected patches, and an end dropped in an awkward place (a sea
   * corner, over the rim) snapped to its nearest cell can land in a pocket no corridor joins. Both
   * asked-for ends snap into the mainland (the largest component), so one spanning tree holds the pair
   * and the walk between them exists by construction.
   */
  it('lands every asked-for pair where a walk exists between them, on the real map', () => {
    const askedPairs: Array<{ entrance: MacroCoord; exit: MacroCoord }> = [
      { entrance: { x: 0, y: 0 }, exit: { x: 500, y: 500 } },
      { entrance: { x: 0, y: 200 }, exit: { x: 90, y: 3 } },
      { entrance: { x: 40, y: 0 }, exit: { x: 45, y: 60 } },
    ];
    for (const [i, asked] of askedPairs.entries()) {
      const state = islandState();
      const exec = makeExecutor(state);
      const start = exec.beginStroke();
      const fp = mazeFootprint(state, null, 1)!;
      const { gates, walk } = generateMaze(
        { state, execute: (c: Command) => exec.execute(c) }, { seed: 7 + i, maxElevation: 3, corridorWidth: 1, region: null, mazeGates: asked },
      );
      start.commit();

      expect(gates.entrance, `pair ${i}: entrance landed`).toBeTruthy();
      expect(gates.exit, `pair ${i}: exit landed`).toBeTruthy();
      const field = fieldOf(state, fp);
      const ring = (c: MacroCoord): boolean =>
        c.x === fp.origin.x || c.y === fp.origin.y
        || c.x === fp.origin.x + fp.dims.mazeW - 1 || c.y === fp.origin.y + fp.dims.mazeH - 1;
      const kindOf = (c: MacroCoord): MazeEnd => ({ cell: c, kind: ring(c) ? 'hole' : 'target' });
      const length = walkLength(field, kindOf(gates.entrance!), kindOf(gates.exit!));
      expect(length, `pair ${i}: a walk joins the pair`).not.toBeNull();

      // The walk stays in the maze. The run's own reported walk runs through carved corridors and
      // never skims the rim: on the map the coast refuses some walls, and a route over all open
      // ground could slip through such a gap and skirt the rectangle's edge — cheating, since no
      // corridor put it there. Gates are the only ring cells the walk may touch.
      expect(walk, `pair ${i}: the run reports its walk`).toBeTruthy();
      const gateCells = new Set([gates.entrance, gates.exit].filter(Boolean).map((g) => `${g!.x},${g!.y}`));
      for (const c of walk!) {
        const offside = ring(c) && !gateCells.has(`${c.x},${c.y}`);
        expect(`rim:${offside}`, `pair ${i}: walk cell ${c.x},${c.y}`).toBe('rim:false');
        expect(`wall:${!!getCell(state.cells, c.x, c.y)?.terrain && !gateCells.has(`${c.x},${c.y}`)}`).toBe('wall:false');
      }
    }
  });
});
