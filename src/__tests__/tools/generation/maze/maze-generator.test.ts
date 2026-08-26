import { describe, it, expect } from 'vitest';
import { generateMaze } from '../../../../tools/generation/maze/maze-generator';
import { CellZone, TerrainType, CommandType, type EditorEvents } from '../../../../core/model/types';
import type { Command, MacroCoord, ValidationResult } from '../../../../core/model/types';
import { makeState, setZone } from '../../../rules/_helpers';
import { getCell } from '../../../../core/model/grid-model';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';

function simpleExecutor(state: ReturnType<typeof makeState>) {
  return (cmd: Command): ValidationResult => {
    if (cmd.type === CommandType.PaintTerrain) {
      for (const c of cmd.cells) {
        const cell = getCell(state.cells, c.x, c.y);
        if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: cmd.elevation };
      }
    }
    return { success: true, errors: [] };
  };
}

/** Rect region whose extent is a whole number of cells at both corridor widths under test, so the
 *  maze footprint is exactly this rect and the test never has to re-derive the lattice arithmetic. */
const GATE_REGION = { x0: 2, y0: 2, x1: 18, y1: 18 };
function gateRegionCells(): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = GATE_REGION.y0; y <= GATE_REGION.y1; y++)
    for (let x = GATE_REGION.x0; x <= GATE_REGION.x1; x++) cells.push({ x, y });
  return cells;
}

/** The footprint's border ring in cyclic order, so contiguous openings come out as single runs. */
function perimeter(): MacroCoord[] {
  const { x0, y0, x1, y1 } = GATE_REGION;
  const ring: MacroCoord[] = [];
  for (let x = x0; x <= x1; x++) ring.push({ x, y: y0 });
  for (let y = y0 + 1; y <= y1; y++) ring.push({ x: x1, y });
  for (let x = x1 - 1; x >= x0; x--) ring.push({ x, y: y1 });
  for (let y = y1 - 1; y > y0; y--) ring.push({ x: x0, y });
  return ring;
}

/** Maximal runs of unpainted cells around the border ring: one run per gate. */
function openings(state: ReturnType<typeof makeState>): MacroCoord[][] {
  const ring = perimeter();
  const open = ring.map(c => !getCell(state.cells, c.x, c.y)?.terrain);
  const runs: MacroCoord[][] = [];
  let run: MacroCoord[] | null = null;
  for (let i = 0; i < ring.length; i++) {
    if (!open[i]) { run = null; continue; }
    if (!run) { run = []; runs.push(run); }
    run.push(ring[i]!);
  }
  // The walk starts mid-side, but a gate never touches a corner, so no run wraps the seam.
  return runs;
}

/** Plain 4-way flood fill over unpainted cells from a corner well outside the maze. */
function reachableFromOutside(state: ReturnType<typeof makeState>, w: number, h: number): Set<string> {
  const seen = new Set<string>(['0,0']);
  const queue: MacroCoord[] = [{ x: 0, y: 0 }];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (getCell(state.cells, nx, ny)?.terrain) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

describe('Maze gates', () => {
  it('lets a walker in from outside and reach every passage', () => {
    const state = makeState(24, 24);
    const { gates } = generateMaze(state, 42, 1, 1, gateRegionCells(), simpleExecutor(state), {
      entrance: { x: 2, y: 10 },
      exit: { x: 18, y: 10 },
    });

    const reached = reachableFromOutside(state, 24, 24);
    // The reported gates are the cells the walker actually comes through.
    for (const gate of [gates.entrance, gates.exit]) {
      expect(gate).not.toBeNull();
      expect(getCell(state.cells, gate!.x, gate!.y)?.terrain ?? null).toBeNull();
      expect(reached.has(`${gate!.x},${gate!.y}`)).toBe(true);
    }

    const passages: MacroCoord[] = [];
    for (let y = GATE_REGION.y0; y <= GATE_REGION.y1; y++)
      for (let x = GATE_REGION.x0; x <= GATE_REGION.x1; x++)
        if (!getCell(state.cells, x, y)?.terrain) passages.push({ x, y });

    expect(passages.length).toBeGreaterThan(0);
    const stranded = passages.filter(c => !reached.has(`${c.x},${c.y}`));
    expect(stranded, `unreachable passages: ${stranded.slice(0, 5).map(c => `(${c.x},${c.y})`).join(' ')}`).toEqual([]);
  });

  /** With nothing asked for and no plaza to head for, the default is edge to edge at the longest
   *  walk the carve holds — which is a pair of ends the run finds, not a side it picks. */
  it('opens exactly two ways in when none are supplied, and reports both', () => {
    const state = makeState(24, 24);
    const { gates } = generateMaze(state, 42, 1, 1, gateRegionCells(), simpleExecutor(state));

    const runs = openings(state);
    expect(runs.length).toBe(2);
    expect(runs.every(r => r.length === 1)).toBe(true);
    // Both defaulted ends are reported, so a caller can mark them without having picked them, and
    // each is one of the two openings.
    const cut = runs.map(r => `${r[0]!.x},${r[0]!.y}`).sort();
    expect([gates.entrance, gates.exit].map(g => `${g!.x},${g!.y}`).sort()).toEqual(cut);
    // Still enterable without a caller asking for it.
    const reached = reachableFromOutside(state, 24, 24);
    expect(reached.has(`${runs[0]![0]!.x},${runs[0]![0]!.y}`)).toBe(true);
  });

  it('reports the same gates for the same seed, and reports a gate the caller did not ask for as null', () => {
    const runs = [0, 1].map(() => {
      const state = makeState(24, 24);
      return generateMaze(state, 99, 1, 1, gateRegionCells(), simpleExecutor(state)).gates;
    });
    expect(runs[0]).toEqual(runs[1]);

    const state = makeState(24, 24);
    const { gates } = generateMaze(state, 99, 1, 1, gateRegionCells(), simpleExecutor(state), { entrance: { x: 6, y: 5 } });
    expect(gates.exit).toBeNull();
    expect(gates.entrance).not.toBeNull();
  });

  /**
   * AN INTERIOR END IS A DESTINATION, not a badly-aimed gate: the DROP decides, and a place inside is a
   * place to REACH, which costs no terrain at all since a corridor is already walkable. Snapping the
   * coordinate to the border ring instead would silently move the end to the map's edge.
   */
  it('takes an interior coordinate as a destination, cutting no hole for it', () => {
    const state = makeState(24, 24);
    const { gates } = generateMaze(state, 42, 1, 1, gateRegionCells(), simpleExecutor(state), { entrance: { x: 6, y: 5 } });

    expect(openings(state)).toEqual([]);
    const landed = gates.entrance!;
    // Inside the maze, on a cell a walker can stand on, and near what was asked for.
    expect(landed.x).toBeGreaterThan(GATE_REGION.x0);
    expect(landed.x).toBeLessThan(GATE_REGION.x1);
    expect(getCell(state.cells, landed.x, landed.y)?.terrain ?? null).toBeNull();
    expect(Math.abs(landed.x - 6) + Math.abs(landed.y - 5)).toBeLessThanOrEqual(2);
  });

  /** A hole is one cell at every corridor width: a doorway into a wide corridor, and the cell the
   *  end's own marker stands on. The wall it is cut in is one cell thick whatever the corridors are. */
  it('cuts a one-cell hole whatever the corridor width', () => {
    const state = makeState(24, 24);
    const { gates } = generateMaze(state, 42, 1, 3, gateRegionCells(), simpleExecutor(state), {
      entrance: { x: 10, y: 2 },
      exit: { x: 10, y: 18 },
    });

    const runs = openings(state);
    expect(runs.length).toBe(2);
    expect(runs.map(r => r.length)).toEqual([1, 1]);
    const cut = runs.map(r => `${r[0]!.x},${r[0]!.y}`).sort();
    expect([gates.entrance, gates.exit].map(g => `${g!.x},${g!.y}`).sort()).toEqual(cut);
  });

  it('keeps gated walls rule-valid through the real executor', () => {
    const state = makeState(40, 40);
    for (let i = 0; i < 40; i++) { setZone(state, i, 0, CellZone.Beach); setZone(state, i, 39, CellZone.Beach); setZone(state, 0, i, CellZone.Beach); setZone(state, 39, i, CellZone.Beach); }
    const bus = new EventBus<EditorEvents>();
    let fails = 0;
    bus.on('validation-failed', () => { fails++; });
    const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
    const start = exec.getUndoStackSize();
    const { placed, skipped } = generateMaze(state, 7, 3, 2, null, (c) => exec.execute(c), {
      entrance: { x: 20, y: 20 },
      exit: { x: 1, y: 20 },
    });
    expect(exec.commitStrokeGroup(start)).toEqual([]);
    expect(placed).toBeGreaterThan(0);
    expect(skipped).toBe(0);
    expect(fails).toBe(0);
  });
});

describe('Maze generator', () => {
  it('generates maze within an L-shaped region', () => {
    const state = makeState(20, 20);
    const region = [];
    for (let y = 2; y <= 8; y++)
      for (let x = 2; x <= 8; x++)
        region.push({ x, y });
    for (let y = 2; y <= 4; y++)
      for (let x = 9; x <= 12; x++)
        region.push({ x, y });

    const result = generateMaze(state, 42, 1, 1, region, simpleExecutor(state));
    expect(result.placed).toBeGreaterThan(0);

    const regionSet = new Set(region.map(c => `${c.x},${c.y}`));
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const cell = getCell(state.cells, x, y);
        if (cell?.terrain && !regionSet.has(`${x},${y}`)) {
          throw new Error(`Mountain placed outside region at (${x},${y})`);
        }
      }
    }
  });

  it('handles disconnected region (fills at least one component)', () => {
    const state = makeState(20, 20);
    const region = [];
    for (let y = 2; y <= 5; y++)
      for (let x = 2; x <= 5; x++)
        region.push({ x, y });
    for (let y = 12; y <= 15; y++)
      for (let x = 12; x <= 15; x++)
        region.push({ x, y });

    const result = generateMaze(state, 42, 1, 1, region, simpleExecutor(state));
    expect(result.placed).toBeGreaterThan(0);
  });

  it('generates maze for full map when no region specified', () => {
    const state = makeState(15, 15);
    const result = generateMaze(state, 42, 1, 1, null, simpleExecutor(state));
    expect(result.placed).toBeGreaterThan(0);
  });

  // Through the REAL rule executor on a map with a non-grass (beach) border: no command is rejected and
  // the committed state is rule-clean at every elevation. The failure this catches is an edge wall
  // tripping V-ZONE-01 (zone not buildable) and then floating a higher layer onto the bare cell.
  it('produces rule-valid terrain on a bordered map at every elevation (no zone / floating errors)', () => {
    for (const maxElev of [1, 2, 3]) {
      const state = makeState(40, 40);
      for (let i = 0; i < 40; i++) { setZone(state, i, 0, CellZone.Beach); setZone(state, i, 39, CellZone.Beach); setZone(state, 0, i, CellZone.Beach); setZone(state, 39, i, CellZone.Beach); }
      const bus = new EventBus<EditorEvents>();
      let fails = 0;
      bus.on('validation-failed', () => { fails++; });
      const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
      const start = exec.getUndoStackSize();
      const { placed, skipped } = generateMaze(state, 42, maxElev, 1, null, (c) => exec.execute(c));
      const postViol = exec.commitStrokeGroup(start).length;
      expect(placed, `maxElev ${maxElev} placed`).toBeGreaterThan(0);
      expect(skipped, `maxElev ${maxElev} skipped`).toBe(0);
      expect(fails, `maxElev ${maxElev} rejected commands`).toBe(0);
      expect(postViol, `maxElev ${maxElev} post-stroke`).toBe(0);
    }
  });

});

/**
 * THE WAY IS DRAWN OVER THE CORRIDOR, NOT DOWN THE MIDDLE OF IT. The route between the ends is one
 * cell wide because a search over cells is; the corridor is as wide as the recipe asked for, and a
 * line drawn down a three-wide corridor reads as a road painted on its floor rather than as the
 * floor. So the generator widens the route over the lattice bands the carve actually filled.
 */
describe('the way between the ends', () => {
  const key = (c: MacroCoord): string => `${c.x},${c.y}`;
  const ends = { entrance: { x: GATE_REGION.x0, y: 10 }, exit: { x: GATE_REGION.x1, y: 10 } };
  const onRing = (c: MacroCoord): boolean => c.x === GATE_REGION.x0 || c.y === GATE_REGION.y0
    || c.x === GATE_REGION.x1 || c.y === GATE_REGION.y1;

  it('is the route itself where a corridor is one cell wide', () => {
    const state = makeState(24, 24);
    const { walk } = generateMaze(state, 42, 1, 1, gateRegionCells(), simpleExecutor(state), ends);
    expect(walk).not.toBeNull();
    for (let i = 1; i < walk!.length; i++) {
      const step = Math.abs(walk![i]!.x - walk![i - 1]!.x) + Math.abs(walk![i]!.y - walk![i - 1]!.y);
      expect(step, 'one walk, cell by cell').toBe(1);
    }
  });

  it('fills a wider corridor across its whole width, and never a wall', () => {
    const state = makeState(24, 24);
    const { walk } = generateMaze(state, 42, 1, 3, gateRegionCells(), simpleExecutor(state), ends);
    expect(walk).not.toBeNull();
    const shown = new Set(walk!.map(key));

    for (const c of walk!) expect(getCell(state.cells, c.x, c.y)?.terrain ?? null).toBeNull();

    // Three cells across, everywhere but the gate cut through the ring, which is one cell of wall
    // taken out and stays one: every drawn cell stands inside a full three-by-three of the drape.
    const inBlock = (c: MacroCoord): boolean =>
      [0, -1, -2].some((ox) => [0, -1, -2].some((oy) =>
        [0, 1, 2].every((dx) => [0, 1, 2].every((dy) => shown.has(key({ x: c.x + ox + dx, y: c.y + oy + dy }))))));
    for (const c of walk!.filter((cell) => !onRing(cell))) {
      expect({ cell: key(c), filled: inBlock(c) }).toEqual({ cell: key(c), filled: true });
    }
  });
});
