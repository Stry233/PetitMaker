/*
 * The maze's two ends: what they promise, and the one thing they do not.
 *
 * The carve is a spanning tree, so exactly one route runs between any two corridors. That says nothing
 * about the ground the maze is standing on. The probe below asks the only question that settles it: can
 * a walker leave by one gate, stay out of the maze, and arrive at the other?
 *
 * The answer measured on the real shipped island is YES, and it is not a sealing failure. The maze's own
 * border ring already walls it: a maze in a painted region has exactly two ways in, the two gates, and
 * nothing else on its rim is standable. The walker simply steps out of one gate onto the lawn the maze is
 * sitting on, walks round the outside of the rectangle, and steps into the other. Two holes in the outer
 * boundary of one simply-connected shape are two doors onto the same outside, so no wall the generator is
 * allowed to build can separate them: the exterior route exists for topological reasons, not for want of
 * a band. The one arrangement that removes it is the one the design already prefers, an endpoint INSIDE
 * the maze, where entering is the only way to arrive.
 *
 * Marked `it.fails` because it genuinely does. Removing the marker needs a decision about what the
 * guarantee is, not more wall.
 */
import { describe, it, expect } from 'vitest';
import { defaultEnds, gateSites, routeBetween, walkLength, type MazeEnd, type MazeField } from '../../tools/generation/maze-endpoints';
// @ts-ignore - node:fs is untyped here (no @types/node); test reads the shipped map JSONs.
import { readFileSync } from 'node:fs';
import { generateMaze, mazeFootprint } from '../../tools/generation/maze-generator';
import { makeState } from '../rules/_helpers';
import { objectRect } from '../../state/object-geometry';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { createGrid, createPlazaObject, getCell, isBuildableZone } from '../../core/model/grid-model';
import { realSurface, surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { roadLookup } from '../../state/object-index';
import { TerrainType, type Command, type EditorEvents, type GridState, type MacroCoord, type MapTemplate } from '../../core/model/types';

/** The real shipped island: a grass disc inside beach inside sea, with the locked plaza in the middle. */
function islandState(file = 'hexia.json'): GridState {
  const template = JSON.parse(readFileSync(`src/config/maps/${file}`, 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}

/**
 * The surface a person could stand on here, or null for somewhere they could not be. Taken from the
 * engine rather than invented: `agent/quality.ts` and `placement/analysis.ts` both walk the same
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
 * A step needs both cells standing at the SAME elevation, which is what makes a raised wall a wall: there
 * is no ramp in a maze, so a walk that starts on the ground stays on it. Both gates sit ON the rectangle,
 * so they are the two cells of it the walk may use: it has to step straight out of `from` and back into
 * `to`, and everything else within the rectangle is the maze.
 */
function routeAroundOutside(state: GridState, fp: { origin: MacroCoord; dims: { mazeW: number; mazeH: number } }, from: MacroCoord, to: MacroCoord): MacroCoord[] | null {
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

/** Lay a maze on the island through the live rule registry, one stroke group, gates north and south. */
function mazeOnIsland(seed: number, region: MacroCoord[] | null) {
  const state = islandState();
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const start = exec.getUndoStackSize();
  const fp = mazeFootprint(state, region, 1)!;
  const result = generateMaze(state, seed, 3, 1, region, (c: Command) => exec.execute(c), {
    entrance: { x: fp.origin.x + (fp.dims.mazeW >> 1), y: fp.origin.y },
    exit: { x: fp.origin.x + (fp.dims.mazeW >> 1), y: fp.origin.y + fp.dims.mazeH - 1 },
  });
  const violations = exec.commitStrokeGroup(start);
  return { state, fp, violations, ...result };
}

describe('Maze endpoints: no walk-around', () => {
  it.fails('gives no walkable route between the two gates that skips the maze', () => {
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

  // The half of the promise that DOES hold, and the reason a band would add nothing here: the border ring
  // already seals the maze, so the only cells of it a walker outside can step into are the two gates.
  it('is entered only at its two gates', () => {
    const { state, fp, gates } = mazeOnIsland(1, regionCells());
    const { origin: o, dims: d } = fp;
    const inMaze = (x: number, y: number): boolean => x >= o.x && x < o.x + d.mazeW && y >= o.y && y < o.y + d.mazeH;
    const waysIn: string[] = [];
    for (let y = o.y; y < o.y + d.mazeH; y++) for (let x = o.x; x < o.x + d.mazeW; x++) {
      const here = standing(state, x, y);
      if (here === null) continue;
      if (STEPS.some(([dx, dy]) => !inMaze(x + dx, y + dy) && standing(state, x + dx, y + dy) === here)) waysIn.push(`${x},${y}`);
    }
    expect(waysIn.sort()).toEqual([`${gates.entrance!.x},${gates.entrance!.y}`, `${gates.exit!.x},${gates.exit!.y}`].sort());
  });
});

/** The field as the FINISHED MAP shows it, which is the view the interface takes: a walker's ground
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
   * THE GUARANTEE, and it is the one the default relies on: with an end INSIDE the maze, entering is
   * the only way to arrive, and the carve's spanning tree makes that route unique. A tree is exactly
   * "one route between any two of its cells", so what is asserted is that the maze plus its one hole
   * IS one — connected, with a vertex more than it has edges.
   */
  it('leaves exactly one route from the way in to a destination inside', () => {
    const state = islandState();
    const region = regionCells();
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const start = exec.getUndoStackSize();
    const fp = mazeFootprint(state, region, 1)!;
    const { gates } = generateMaze(state, 3, 3, 1, region, (c: Command) => exec.execute(c), {
      entrance: { x: fp.origin.x, y: fp.origin.y + (fp.dims.mazeH >> 1) },
      exit: { x: fp.origin.x + (fp.dims.mazeW >> 1), y: fp.origin.y + (fp.dims.mazeH >> 1) },
    });
    expect(exec.commitStrokeGroup(start)).toEqual([]);

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
   * THE ANSWER IS ALWAYS THERE TO SHOW. The carve is a spanning tree, so the route between the two
   * ends is unique and does not have to be searched for — and it exists at EVERY corridor width,
   * one-wide included, which is why the answer is a drape rather than a road: a road's flat trait
   * refuses a corridor cell with wall below or right of it, which in a maze is most of them, and
   * on the default one-wide maze it paved nothing at all. A route that is drawn has to BE the
   * route, so this holds it against the walk the readout reports rather than against itself.
   */
  it('finds the one route, at a wide corridor and at the one-wide default alike', () => {
    for (const cw of [1, 3]) {
      const state = makeState(28, 28);
      const region: MacroCoord[] = [];
      for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) region.push({ x, y });
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      const start = exec.getUndoStackSize();
      const fp = mazeFootprint(state, region, cw)!;
      const { gates } = generateMaze(state, 11, 3, cw, region, (c: Command) => exec.execute(c));
      exec.commitStrokeGroup(start);

      const field = fieldOf(state, fp);
      const entrance: MazeEnd = { cell: gates.entrance!, kind: 'hole' };
      const exit: MazeEnd = { cell: gates.exit!, kind: 'hole' };

      const route = routeBetween(field, entrance, exit);
      expect(route, `route exists (cw ${cw})`).not.toBeNull();
      // The route IS the walk: same cells counted, both ends included.
      expect(route!.length).toBe(walkLength(field, entrance, exit));
      // Every cell of it is ground a walker can stand on, or one of the two holes.
      const holes = new Set([`${entrance.cell.x},${entrance.cell.y}`, `${exit.cell.x},${exit.cell.y}`]);
      for (const c of route!) {
        expect(`walkable:${field.walkable(c.x, c.y) || holes.has(`${c.x},${c.y}`)}`).toBe('walkable:true');
      }
    }
  });

  /**
   * THE ENDS ARE RECIPE INPUTS: the carve grows out from the entrance, so asking for a different
   * way in at the same seed answers with a different maze, not the same corridors with a new hole.
   */
  it('reshapes the maze when the entrance moves, at the same seed', () => {
    const carve = (entrance: MacroCoord): string => {
      const state = makeState(28, 28);
      const region: MacroCoord[] = [];
      for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) region.push({ x, y });
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      const fp = mazeFootprint(state, region, 1)!;
      generateMaze(state, 11, 3, 1, region, (c: Command) => exec.execute(c), {
        entrance, exit: { x: fp.origin.x + fp.dims.mazeW - 1, y: fp.origin.y + (fp.dims.mazeH >> 1) },
      });
      let walls = '';
      for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) walls += state.cells[y]![x]!.terrain ? '#' : '.';
      return walls;
    };
    const a = carve({ x: 2, y: 2 });
    const b = carve({ x: 2, y: 24 });
    expect(a).not.toBe(b);
  });

  /**
   * THE DEFAULT IS THE LONGEST WALK, where there is no plaza to head for. Checked against every
   * other pair of ways in the maze offers, which is what "longest" has to mean.
   */
  it('defaults to the longest walk the maze holds when nothing is there to reach', () => {
    const state = makeState(28, 28);
    const region: MacroCoord[] = [];
    for (let y = 2; y <= 24; y++) for (let x = 2; x <= 24; x++) region.push({ x, y });
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const start = exec.getUndoStackSize();
    const fp = mazeFootprint(state, region, 1)!;
    const { gates } = generateMaze(state, 11, 3, 1, region, (c: Command) => exec.execute(c));
    exec.commitStrokeGroup(start);

    const field = fieldOf(state, fp);
    const chosen = walkLength(field, { cell: gates.entrance!, kind: 'hole' }, { cell: gates.exit!, kind: 'hole' })!;
    expect(chosen).toBeGreaterThan(0);

    // Every OTHER pair of places a hole could have been cut, measured the same way. The two that
    // were chosen are already cut, so the field sees them as walkable and the rest as wall — which
    // is exactly how a candidate pair is measured from a hole that is not cut yet.
    for (const a of gateSites(field)) {
      for (const b of gateSites(field)) {
        if (a === b) continue;
        const walk = walkLength(field, { cell: a.gate, kind: 'hole' }, { cell: b.gate, kind: 'hole' });
        if (walk !== null) expect(walk).toBeLessThanOrEqual(chosen);
      }
    }
  });

  /**
   * A DESTINATION IS REACHED WITHOUT BEING BUILT ON. The plaza is unbuildable, so the maze routes
   * around it and the end is the corridor touching its edge — which is also why the plaza makes a
   * better default than an edge: arriving somewhere means something.
   */
  it('puts the destination on the corridor touching the plaza, and builds nothing on it', () => {
    const state = islandState();
    // A region around the square itself, so the plaza is inside the maze's own rectangle. The
    // square is an OBJECT on grass rather than a zone — `createGrid` lays no Plaza cells — so its
    // footprint is what both this test and the generator read.
    const plaza: MacroCoord[] = [];
    for (const obj of state.objects.values()) {
      if (!obj.locked) continue;
      const rect = objectRect(obj);
      for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y++) {
        for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x++) plaza.push({ x, y });
      }
    }
    expect(plaza.length).toBeGreaterThan(0);
    const square = new Set(plaza.map(c => `${c.x},${c.y}`));
    const cx = Math.round(plaza.reduce((s, c) => s + c.x, 0) / plaza.length);
    const cy = Math.round(plaza.reduce((s, c) => s + c.y, 0) / plaza.length);
    const region = regionCells(cx - 20, cy - 20, cx + 20, cy + 20);

    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const start = exec.getUndoStackSize();
    const { gates } = generateMaze(state, 5, 3, 1, region, (c: Command) => exec.execute(c));
    expect(exec.commitStrokeGroup(start)).toEqual([]);

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
   * THE WALK ALWAYS EXISTS. On the real island the maze's rectangle covers sea and sand, so the
   * walkable cells are several disconnected patches — and ends dropped in awkward places (the sea
   * corners, over the rim) used to snap blindly to their nearest cells, which could sit in pockets
   * no corridor joins. Both asked-for ends now snap into the MAINLAND (the largest component), so
   * one spanning tree holds the pair and the walk between them exists by construction.
   */
  it('lands every asked-for pair where a walk exists between them, on the real island', () => {
    const askedPairs: Array<{ entrance: MacroCoord; exit: MacroCoord }> = [
      { entrance: { x: 0, y: 0 }, exit: { x: 500, y: 500 } },
      { entrance: { x: 0, y: 200 }, exit: { x: 90, y: 3 } },
      { entrance: { x: 40, y: 0 }, exit: { x: 45, y: 60 } },
    ];
    for (const [i, asked] of askedPairs.entries()) {
      const state = islandState();
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      const start = exec.getUndoStackSize();
      const fp = mazeFootprint(state, null, 1)!;
      const { gates, walk } = generateMaze(state, 7 + i, 3, 1, null, (c: Command) => exec.execute(c), asked);
      exec.commitStrokeGroup(start);

      expect(gates.entrance, `pair ${i}: entrance landed`).toBeTruthy();
      expect(gates.exit, `pair ${i}: exit landed`).toBeTruthy();
      const field = fieldOf(state, fp);
      const ring = (c: MacroCoord): boolean =>
        c.x === fp.origin.x || c.y === fp.origin.y
        || c.x === fp.origin.x + fp.dims.mazeW - 1 || c.y === fp.origin.y + fp.dims.mazeH - 1;
      const kindOf = (c: MacroCoord): MazeEnd => ({ cell: c, kind: ring(c) ? 'hole' : 'target' });
      const length = walkLength(field, kindOf(gates.entrance!), kindOf(gates.exit!));
      expect(length, `pair ${i}: a walk joins the pair`).not.toBeNull();

      // THE WALK STAYS IN THE MAZE. The run's own reported walk runs through carved corridors and
      // never skims the rim: on the island the coast refuses some walls, and a route over all open
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
