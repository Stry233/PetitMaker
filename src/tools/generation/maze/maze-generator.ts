import { CommandType, CellZone, TerrainType } from '../../../core/model/types';
import type { Command, GridState, MacroCoord, MazeGates, ResolvedMazeGates, ValidationResult } from '../../../core/model/types';
import { getCell, isBuildableZone } from '../../../core/model/grid-model';
import { buildObjectOccupancy, objectRect } from '../../../state/object-geometry';
import { makeRng } from '../../../core/model/rng';
import { defaultEnds, mainland, resolveEnd, routeBetween, type MazeEnd, type MazeField } from './maze-endpoints';

/** The cell-wall lattice a gate is expressed in. `cw` cells of corridor, then one of wall. */
export interface MazeDims { mazeW: number; mazeH: number; cellsW: number; cellsH: number; step: number; cw: number }

/** The rectangle the maze occupies: its top-left corner in map coordinates plus the lattice it fills. */
export interface MazeFootprint { origin: MacroCoord; dims: MazeDims }

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
        if (cell && cell.zone === CellZone.Grass && !occ.has(`${x},${y}`)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  // Cell step = corridorWidth + 1 (corridor + wall between)
  const cw = Math.max(1, Math.min(3, corridorWidth));
  const step = cw + 1;
  const cellsW = Math.max(2, Math.floor((maxX - minX) / step));
  const cellsH = Math.max(2, Math.floor((maxY - minY) / step));
  const mazeW = cellsW * step + 1;
  const mazeH = cellsH * step + 1;
  if (mazeW < 3 || mazeH < 3) return null;
  return { origin: { x: minX, y: minY }, dims: { mazeW, mazeH, cellsW, cellsH, step, cw } };
}

/**
 * The maze's LATTICE as a field, before (or without) any carve: a cell is walkable when it sits on
 * a room position of the corridor lattice and a walker could stand there. Every carve opens every
 * room, so this is the seed-independent skeleton of any maze the footprint can hold — what a mark
 * dropped before a run exists is snapped against, so the run then opens a gate EXACTLY where the
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
 * The route WIDENED to the corridor it runs down, which is what the way is drawn as.
 *
 * A search over cells returns a line one cell wide; a corridor is `cw` of them, and a line down the
 * middle of a three-wide corridor reads as a road painted on a floor rather than as the floor. The
 * carve fills whole lattice BANDS — a room is cw by cw, a connector is cw across the wall it crosses
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
        const key = `${x},${y}`;
        if (seen.has(key) || !open(x, y)) continue;
        seen.add(key);
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * Generate a maze using recursive backtracker (randomized DFS).
 *
 * The grid is treated as a cell-wall grid:
 * - Odd coordinates = cells (passages or rooms)
 * - Even coordinates = walls (mountains)
 *
 * The algorithm:
 * 1. Start with all cells as walls (mountains)
 * 2. Pick a random starting cell (odd coords)
 * 3. Mark it as passage (empty)
 * 4. While stack is not empty:
 *    a. Get unvisited neighbors (2 cells away in cardinal directions)
 *    b. If any: pick random, remove wall between, push to stack, recurse
 *    c. If none: backtrack (pop stack)
 * 5. Open the border ring at whichever ends turned out to be holes
 * 6. All remaining walls = mountains at the specified elevation
 *
 * The DFS visits only cells strictly inside the border ring, so the maze it leaves is sealed. Step 5
 * is the only way in or out. A backtracker's output is a spanning tree over the cells, so one gate
 * already reaches every cell and a second one already has a path to the first: an opening is all a
 * gate is, and nothing here searches for a route.
 *
 * AN END IS A HOLE OR A DESTINATION, AND WHERE IT WAS DROPPED DECIDES (`maze-endpoints.ts`). A
 * request on the border ring is cut as an opening; anything else is a place INSIDE the maze to
 * reach, and reaching it costs no terrain at all — it is already a corridor. With nothing requested
 * the default is in from the edge and out at the plaza, or, on a map with no plaza near the maze,
 * the longest walk the carve holds.
 */
export function generateMaze(
  state: GridState,
  seed: number,
  maxElevation: number,
  corridorWidth: number,
  region: MacroCoord[] | null,
  executeCommand: (cmd: Command) => ValidationResult,
  gates?: MazeGates,
): { placed: number; skipped: number; gates: ResolvedMazeGates; walk: MacroCoord[] | null } {
  const rand = makeRng(seed).float;
  const occ = buildObjectOccupancy(state);

  // Build region membership set (if region provided) to filter placement
  const regionSet: Set<string> | null = region && region.length > 0
    ? new Set(region.map(c => `${c.x},${c.y}`))
    : null;

  const footprint = mazeFootprint(state, region, corridorWidth);
  if (!footprint) return { placed: 0, skipped: 0, gates: { entrance: null, exit: null }, walk: null };
  const { origin, dims } = footprint;
  const { x: minX, y: minY } = origin;
  const { mazeW, mazeH, step, cw } = dims;

  // Initialize: all cells are walls
  const grid: boolean[][] = [];
  for (let y = 0; y < mazeH; y++) {
    grid.push(Array(mazeW).fill(false) as boolean[]);
  }

  /*
   * The carve STARTS AT THE ENTRANCE when one was asked for. A backtracker's spanning tree grows
   * out from its start, so where it starts shapes every corridor — which is what makes the two
   * ends recipe inputs rather than marks placed on a finished maze: ask for a different way in and
   * the whole maze answers, at the same seed. With no gates the start is the lattice corner, which
   * is what the same seed carved before gates existed.
   */
  const latticeAt = (want: number, cellsAcross: number, off: number): number =>
    Math.min(cellsAcross - 1, Math.max(0, Math.round((want - off - 1) / step))) * step + 1;
  const startX = gates?.entrance ? latticeAt(gates.entrance.x, dims.cellsW, minX) : 1;
  const startY = gates?.entrance ? latticeAt(gates.entrance.y, dims.cellsH, minY) : 1;
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

  /*
   * The two ends, decided after the DFS has consumed all it needs, so an end cannot shift the
   * corridors themselves. The field is the carved lattice read in MAP coordinates, which is the
   * same view the interface takes of the finished map — one implementation, two readers.
   */
  const field: MazeField = {
    origin,
    dims: { mazeW, mazeH },
    /*
     * A corridor is a cell the lattice left open AND a person could stand on.
     *
     * The lattice knows nothing about the island: its rectangle is the bounding box of the free
     * grass, and on a real map that box also covers sea, sand and the square. Those cells take no
     * wall either, so a lattice-only reading calls them corridor — and the default put a way IN on
     * a ring cell in the middle of the ocean, with no route from it to anywhere. Asking the map the
     * same question the interface will ask it once the run has landed is what keeps the two
     * agreeing.
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
   * The square, as the map actually carries it: the LOCKED objects' own footprints.
   *
   * Not the Plaza zone — `createGrid` lays grass under the plaza and the square itself is an object
   * standing on it, so a zone read finds nothing on any shipped map. Nothing else on a map is
   * locked, and a run clears the unlocked objects before it starts.
   *
   * The destination is a corridor TOUCHING it rather than a cell of it: an object blocks the ground
   * it covers, so the maze routes around the square and arrives at its edge.
   */
  const square = new Set<string>();
  for (const obj of state.objects.values()) {
    if (!obj.locked) continue;
    const rect = objectRect(obj);
    for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y++) {
      for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x++) square.add(`${x},${y}`);
    }
  }
  const bySquare = (c: MacroCoord): boolean => !square.has(`${c.x},${c.y}`)
    && ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => square.has(`${c.x + dx},${c.y + dy}`));

  /*
   * Asked-for ends snap INTO THE MAINLAND, never merely to the nearest cell: the rectangle also
   * covers sea and sand on a real island, so the walkable cells can be several disconnected
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

  // A wall cell is buildable only if it's grass, unoccupied, inside the region, AND its UP/LEFT neighbours
  // are grass too. The last part matches V-ZONE-01's bleed guard (a painted block renders -HALF_TILE, so it
  // overlaps its up/left neighbours); skipping those edge cells keeps the maze rule-valid by construction —
  // otherwise an edge wall is rejected at layer 1 (left as bare grass), then layer 2 floats a mountain onto
  // it ("no terrain supported below"). Off-map neighbours are ignored (V-ZONE-01 skips null cells).
  const grassOrOff = (x: number, y: number): boolean => { const c = getCell(state.cells, x, y); return !c || c.zone === CellZone.Grass; };
  const buildable = (x: number, y: number): boolean => {
    const cell = getCell(state.cells, x, y);
    if (!cell || cell.zone !== CellZone.Grass || occ.has(`${x},${y}`)) return false;
    if (regionSet && !regionSet.has(`${x},${y}`)) return false;
    return grassOrOff(x, y - 1) && grassOrOff(x - 1, y);
  };

  // Collect buildable wall cells once, then raise them layer by layer. A layer only paints cells that took
  // the layer below (cumulative bottom-up), so no mountain ever floats above bare ground.
  let live: MacroCoord[] = [];
  for (let my = 0; my < mazeH; my++) for (let mx = 0; mx < mazeW; mx++) {
    if (grid[my]![mx]) continue; // passage, skip
    const x = minX + mx, y = minY + my;
    if (buildable(x, y)) live.push({ x, y });
  }

  let placed = 0, skipped = 0;
  // A wall straight off flat ground tops out 3 above it: the game's 3×3 base-support window reaches 3 tiers.
  const elev = Math.min(maxElevation, 3);
  for (let e = 1; e <= elev && live.length > 0; e++) {
    const cmd: Command = { type: CommandType.PaintTerrain, timestamp: Date.now(), cells: live, terrainType: TerrainType.Mountain, elevation: e };
    if (executeCommand(cmd).success) { placed += live.length; continue; }
    // Fallback: paint individually; only cells that took this layer advance to the next.
    const next: MacroCoord[] = [];
    for (const coord of live) {
      if (executeCommand({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells: [coord], terrainType: TerrainType.Mountain, elevation: e }).success) { placed++; next.push(coord); }
      else skipped++;
    }
    live = next;
  }

  /*
   * The walk between the ends, over THIS CARVE — computed here because only the generator knows
   * it: `field` is the carved corridors and nothing else, where the finished map cannot tell a
   * carved connector from a wall the coast refused to take, so a route recomputed later over all
   * open ground can slip through such gaps and skirt the maze along its rim. Where the island
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
  const walk = route
    ? corridorAlong(route, origin, dims, carved ? field.walkable : ground.walkable)
    : null;

  return { placed, skipped, gates: chosen, walk };
}
