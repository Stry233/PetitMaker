import { CommandType, CellZone, TerrainType } from '../../core/model/types';
import type { Command, GridState, MacroCoord, ValidationResult } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { buildObjectOccupancy } from '../../state/object-geometry';
import { makeRng } from '../../core/model/rng';

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
 * 5. All remaining walls = mountains at the specified elevation
 */
export function generateMaze(
  state: GridState,
  seed: number,
  maxElevation: number,
  corridorWidth: number,
  region: MacroCoord[] | null,
  executeCommand: (cmd: Command) => ValidationResult,
): { placed: number; skipped: number } {
  const { width, height } = state.template;
  const rand = makeRng(seed).float;
  const occ = buildObjectOccupancy(state);

  // Build region membership set (if region provided) to filter placement
  const regionSet: Set<string> | null = region && region.length > 0
    ? new Set(region.map(c => `${c.x},${c.y}`))
    : null;

  // Find bounds from region or full map
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

  // Maze dimensions in cell-wall grid
  const cellsW = Math.max(2, Math.floor((maxX - minX) / step));
  const cellsH = Math.max(2, Math.floor((maxY - minY) / step));
  const mazeW = cellsW * step + 1;
  const mazeH = cellsH * step + 1;

  if (mazeW < 3 || mazeH < 3) return { placed: 0, skipped: 0 };

  // Initialize: all cells are walls
  const grid: boolean[][] = [];
  for (let y = 0; y < mazeH; y++) {
    grid.push(Array(mazeW).fill(false) as boolean[]);
  }

  // Carve out starting room
  const startX = 1;
  const startY = 1;
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
  const elev = Math.min(maxElevation, 3); // Max 3 per rule 2.1
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

  return { placed, skipped };
}
