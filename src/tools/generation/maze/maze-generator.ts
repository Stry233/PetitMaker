import type { GridState, MacroCoord } from '../../../core/model/types';
import { MAZE_MAX_ELEVATION, RECIPE_RANGES, type MazeRecipe, type ResolvedMazeGates } from '../recipe';
import { raiseBottomUp, type MapWriter, type RaiseTarget } from '../terrain-plan';
import { getCell } from '../../../core/model/grid-model';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { isBuildableZone } from '../../../core/game/zones';
import { buildObjectOccupancy } from '../../../state/object-geometry';
import { landmarkCells } from '../../../core/model/landmarks';
import { makeRng } from '../../../core/base/rng';
import { defaultEnds, mainland, resolveEnd, routeBetween, type MazeEnd, type MazeField } from './maze-endpoints';
import { cellKey } from '../../../core/grid/rect';
import { paintBleedsOffBuildable } from '../../../rules/zone-restriction';

/** The cell-wall lattice a gate is expressed in. `cw` cells of corridor, then one of wall. */
interface MazeDims { mazeW: number; mazeH: number; cellsW: number; cellsH: number; step: number; cw: number }

/** The rectangle the maze occupies: its top-left corner in map coordinates plus the lattice it fills. */
export interface MazeFootprint { origin: MacroCoord; dims: MazeDims }

/**
 * The ends a visitor's marks start at: in at the middle of the left wall, out at the centre. Both
 * stand on the room lattice, so a run opens its gates exactly where the untouched marks are.
 */
export function defaultMazeGates({ origin: o, dims: d }: MazeFootprint): ResolvedMazeGates {
  const align = (v: number, cells: number): number =>
    Math.min(cells - 1, Math.max(0, Math.round((v - 1) / d.step))) * d.step + 1;
  const midY = o.y + align(d.mazeH >> 1, d.cellsH);
  return { entrance: { x: o.x, y: midY }, exit: { x: o.x + align(d.mazeW >> 1, d.cellsW), y: midY } };
}

/**
 * The rectangle `generateMaze` will lay its lattice into, for the same arguments — the region's bounding
 * box, or the bounding box of every free grass cell when there is no region. Exported so a caller can ask
 * where the maze goes without generating it, and so a test measures the same rectangle the generator does.
 * Null when the space is too small to hold a maze at all.
 */
export function mazeFootprint(state: GridState, region: MacroCoord[] | null, corridorWidth: number): MazeFootprint | null {
  const { width, height } = state.template;
  const occ = buildObjectOccupancy(state);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  if (region && region.length > 0) {
    for (const c of region) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = getCell(state.cells, x, y);
        if (cell && isBuildableZone(cell.zone) && !occ.has(cellKey(x, y))) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  // Cell step = corridorWidth + 1 (corridor + wall between)
  const cw = Math.max(RECIPE_RANGES.corridorWidth.min, Math.min(RECIPE_RANGES.corridorWidth.max, corridorWidth));
  const step = cw + 1;
  const cellsW = Math.max(2, Math.floor((maxX - minX) / step));
  const cellsH = Math.max(2, Math.floor((maxY - minY) / step));
  const mazeW = cellsW * step + 1;
  const mazeH = cellsH * step + 1;
  if (mazeW < 3 || mazeH < 3) return null;
  return { origin: { x: minX, y: minY }, dims: { mazeW, mazeH, cellsW, cellsH, step, cw } };
}

/**
 * The maze's lattice as a field, before (or without) any carve: a cell is walkable when it sits on
 * a room position of the corridor lattice and a walker could stand there. Every carve opens every
 * room, so this is the seed-independent skeleton of any maze the footprint can hold — what a mark
 * dropped before a run exists is snapped against, so the run then opens a gate exactly where the
 * mark stands instead of re-snapping it.
 */
export function latticeField(state: GridState, fp: MazeFootprint): MazeField {
  const { origin, dims } = fp;
  const room = (m: number): boolean => ((m - 1) % dims.step) < dims.cw;
  return {
    origin,
    dims: { mazeW: dims.mazeW, mazeH: dims.mazeH },
    walkable: (x, y) => {
      const mx = x - origin.x, my = y - origin.y;
      if (mx < 1 || my < 1 || mx >= dims.mazeW - 1 || my >= dims.mazeH - 1) return false;
      if (!room(mx) || !room(my)) return false;
      const cell = getCell(state.cells, x, y);
      return !!cell && isBuildableZone(cell.zone);
    },
  };
}

/**
 * The route widened to the corridor it runs down, which is what the way is drawn as.
 *
 * A search over cells returns a line one cell wide; a corridor is `cw` of them, and a line down the
 * middle of a three-wide corridor reads as a road painted on a floor rather than as the floor. The
 * carve fills whole lattice bands — a room is cw by cw, a connector is cw across the wall it crosses
 * — so each cell of the route is widened over its own band on both axes, which is that corridor's
 * floor exactly and reaches into no branch beside it. A gate cut through the border ring is one cell
 * of wall taken out and stays one: the ring is no band.
 */
function corridorAlong(
  route: MacroCoord[], origin: MacroCoord, dims: MazeDims, open: (x: number, y: number) => boolean,
): MacroCoord[] {
  const { step, cw } = dims;
  if (cw <= 1) return route;
  const band = (m: number): number[] => {
    const at = (m - 1) % step;
    if (m < 1 || at >= cw) return [m];
    return Array.from({ length: cw }, (_, i) => m - at + i);
  };
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const c of route) {
    for (const mx of band(c.x - origin.x)) {
      for (const my of band(c.y - origin.y)) {
        const x = origin.x + mx, y = origin.y + my;
        const key = cellKey(x, y);
        if (seen.has(key) || !open(x, y)) continue;
        seen.add(key);
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * The recursive backtracker's carve over the lattice `dims`, from the room at (`startX`, `startY`):
 * true where a room or connector was opened, false where a wall stands.
 */
function carveLattice(dims: MazeDims, startX: number, startY: number, rand: () => number): boolean[][] {
  const { mazeW, mazeH, step, cw } = dims;
  // Initialize: all cells are walls
  const grid: boolean[][] = [];
  for (let y = 0; y < mazeH; y++) {
    grid.push(Array(mazeW).fill(false) as boolean[]);
  }

  for (let dy = 0; dy < cw; dy++)
    for (let dx = 0; dx < cw; dx++)
      if (startY + dy < mazeH && startX + dx < mazeW)
        grid[startY + dy]![startX + dx] = true;

  const stack: [number, number][] = [[startX, startY]];
  const dirs: [number, number][] = [[0, -step], [0, step], [-step, 0], [step, 0]];

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1]!;

    // Find unvisited neighbors
    const neighbors: [number, number, number, number][] = [];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 1 && nx < mazeW - 1 && ny >= 1 && ny < mazeH - 1 && !grid[ny]![nx]) {
        // Wall midpoint (center of wall between cells)
        const wmx = cx + dx / 2;
        const wmy = cy + dy / 2;
        neighbors.push([nx, ny, wmx, wmy]);
      }
    }

    if (neighbors.length > 0) {
      const idx = Math.floor(rand() * neighbors.length);
      const [nx, ny] = neighbors[idx]!;

      // Carve corridor from wall midpoint through to neighbor room
      // Wall region
      const wallStartX = Math.min(cx, nx);
      const wallStartY = Math.min(cy, ny);
      const wallEndX = Math.max(cx, nx) + cw - 1;
      const wallEndY = Math.max(cy, ny) + cw - 1;
      for (let fy = wallStartY; fy <= wallEndY && fy < mazeH; fy++)
        for (let fx = wallStartX; fx <= wallEndX && fx < mazeW; fx++)
          grid[fy]![fx] = true;

      // Carve destination room
      for (let dy = 0; dy < cw; dy++)
        for (let dx = 0; dx < cw; dx++)
          if (ny + dy < mazeH && nx + dx < mazeW)
            grid[ny + dy]![nx + dx] = true;

      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }
  return grid;
}

/** The route between the two ends, widened to its corridor; null when either end is missing or
 *  nothing joins them. */
function walkBetween(
  state: GridState, field: MazeField, footprint: MazeFootprint, ends: { entrance: MazeEnd | null; exit: MazeEnd | null },
): MacroCoord[] | null {
  const { origin, dims } = footprint;
  const { mazeW, mazeH } = dims;
  /*
   * The walk between the ends, over this carve — computed here because only the generator knows
   * it: `field` is the carved corridors and nothing else, where the finished map cannot tell a
   * carved connector from a wall the coast refused to take, so a route recomputed later over all
   * open ground can slip through such gaps and skirt the maze along its rim. Where the planet
   * severs the carved tree itself (a connector over sea), the open ground stands in so an answer
   * still exists.
   */
  const ground: MazeField = {
    origin,
    dims: { mazeW, mazeH },
    walkable: (x, y) => {
      const cell = getCell(state.cells, x, y);
      return !!cell && isBuildableZone(cell.zone) && !cell.terrain;
    },
  };
  const carved = ends.entrance && ends.exit ? routeBetween(field, ends.entrance, ends.exit) : null;
  const overGround = !carved && ends.entrance && ends.exit
    ? routeBetween(ground, ends.entrance, ends.exit)
    : null;
  const route = carved ?? overGround;
  // Widened over the field the route was actually found in, or the fallback would draw the way
  // across cells that field never opened.
  return route
    ? corridorAlong(route, origin, dims, carved ? field.walkable : ground.walkable)
    : null;
}

/**
 * Generate a maze with a recursive backtracker (randomized DFS) on a cell-wall grid: odd coordinates
 * are cells, even ones walls (mountains at the given elevation). The DFS visits only cells strictly
 * inside the border ring, so the maze is sealed and opening the border at the hole ends is the only
 * way in or out. Its output is a spanning tree, so any gate reaches every cell and nothing searches
 * for a route.
 *
 * Where an end was dropped decides its kind (`maze-endpoints.ts`): on the border ring it is cut as an
 * opening, anywhere else it is a corridor already. With nothing requested the default is in from the
 * edge and out at the plaza, or the longest walk when no plaza is near.
 */
export function generateMaze(
  { state, execute: executeCommand }: MapWriter,
  { seed, maxElevation, corridorWidth, region, mazeGates: gates }: MazeRecipe,
): { placed: number; skipped: number; gates: ResolvedMazeGates; walk: MacroCoord[] | null } {
  const rand = makeRng(seed).float;
  const occ = buildObjectOccupancy(state);

  // Build region membership set (if region provided) to filter placement
  const regionSet: Set<string> | null = region && region.length > 0
    ? new Set(region.map(c => cellKey(c.x, c.y)))
    : null;

  const footprint = mazeFootprint(state, region, corridorWidth);
  if (!footprint) return { placed: 0, skipped: 0, gates: { entrance: null, exit: null }, walk: null };
  const { origin, dims } = footprint;
  const { x: minX, y: minY } = origin;
  const { mazeW, mazeH, step } = dims;

  // The carve starts at the entrance when one was asked for: a backtracker's spanning tree grows out
  // from its start, so a different way in reshapes the whole maze at the same seed. With no gates the
  // start is the lattice corner.
  const latticeAt = (want: number, cellsAcross: number, off: number): number =>
    Math.min(cellsAcross - 1, Math.max(0, Math.round((want - off - 1) / step))) * step + 1;
  const startX = gates?.entrance ? latticeAt(gates.entrance.x, dims.cellsW, minX) : 1;
  const startY = gates?.entrance ? latticeAt(gates.entrance.y, dims.cellsH, minY) : 1;
  const grid = carveLattice(dims, startX, startY, rand);

  /*
   * The two ends, decided after the DFS has consumed all it needs, so an end cannot shift the
   * corridors themselves. The field is the carved lattice read in map coordinates, which is the
   * same view the interface takes of the finished map — one implementation, two readers.
   */
  const field: MazeField = {
    origin,
    dims: { mazeW, mazeH },
    /*
     * A corridor is a cell the lattice left open and a person could stand on.
     *
     * The lattice knows nothing about the planet: its rectangle is the bounding box of the free
     * grass, and on a real map that box also covers sea, sand and the square. Those cells take no
     * wall either, so a lattice-only reading would call them corridor and could put a way in on a
     * ring cell out at sea. Asking the map the same question the interface will ask it once the run
     * has landed keeps the two agreeing.
     */
    walkable: (x, y) => {
      const mx = x - minX;
      const my = y - minY;
      if (mx < 0 || my < 0 || mx >= mazeW || my >= mazeH || !grid[my]![mx]) return false;
      const cell = getCell(state.cells, x, y);
      return !!cell && isBuildableZone(cell.zone);
    },
  };
  /*
   * The square, as the map actually carries it: the laid landmarks' own footprints.
   *
   * Not a zone: every template records grass under the plaza and the square itself is an object
   * standing on it. A run clears the unlocked objects before it starts.
   *
   * The destination is a corridor touching it rather than a cell of it: an object blocks the ground
   * it covers, so the maze routes around the square and arrives at its edge.
   */
  const square = new Set(landmarkCells(state).map((c) => cellKey(c.x, c.y)));
  const bySquare = (c: MacroCoord): boolean => !square.has(cellKey(c.x, c.y))
    && NEIGHBORS4.some(([dx, dy]) => square.has(cellKey(c.x + dx, c.y + dy)));

  /*
   * Asked-for ends snap into the mainland, never merely to the nearest cell: the rectangle also
   * covers sea and sand on a real map, so the walkable cells can be several disconnected
   * patches, and a pair snapped blindly could land where no corridor joins them. One component,
   * one spanning tree — the walk between the pair exists by construction. The defaults need no
   * such guard: they are chosen by their walks, so an unreachable pairing is never picked.
   */
  const wanted = { entrance: gates?.entrance ?? null, exit: gates?.exit ?? null };
  const ends = wanted.entrance || wanted.exit
    ? (() => {
      const inMain = mainland(field);
      return {
        entrance: wanted.entrance ? resolveEnd(field, wanted.entrance, inMain) : null,
        exit: wanted.exit ? resolveEnd(field, wanted.exit, inMain) : null,
      };
    })()
    : defaultEnds(field, bySquare);

  /** A hole is one ring cell taken out of the wall. A destination costs nothing: it is a corridor
   *  already, and the spanning tree is what makes the route to it the only one. */
  const cut = (end: MazeEnd | null): void => {
    if (!end || end.kind !== 'hole') return;
    grid[end.cell.y - minY]![end.cell.x - minX] = true;
  };
  cut(ends.entrance);
  cut(ends.exit);
  const chosen: ResolvedMazeGates = {
    entrance: ends.entrance?.cell ?? null,
    exit: ends.exit?.cell ?? null,
  };

  // A wall cell is buildable only if it's grass, unoccupied, inside the region, and a block painted on it
  // does not bleed off grass (V-ZONE-01's own test), so each layer lands as one batch.
  const buildable = (x: number, y: number): boolean => {
    const cell = getCell(state.cells, x, y);
    if (!cell || !isBuildableZone(cell.zone) || occ.has(cellKey(x, y))) return false;
    if (regionSet && !regionSet.has(cellKey(x, y))) return false;
    return !paintBleedsOffBuildable(state, { x, y });
  };

  // A layer only paints cells that took the layer below, so no wall ever floats above bare ground.
  const walls: RaiseTarget[] = [];
  const top = Math.min(maxElevation, MAZE_MAX_ELEVATION);
  for (let my = 0; my < mazeH; my++) for (let mx = 0; mx < mazeW; mx++) {
    if (grid[my]![mx]) continue; // passage, skip
    const x = minX + mx, y = minY + my;
    if (buildable(x, y)) walls.push({ coord: { x, y }, top });
  }
  const { placed, skipped } = raiseBottomUp(walls, executeCommand);

  const walk = walkBetween(state, field, footprint, ends);

  return { placed, skipped, gates: chosen, walk };
}
