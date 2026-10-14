/**
 * Connectivity over the board: the paved components, the ones the hub stands in, and what the
 * flights make reachable.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { floodFrom, labelComponents } from '../../../../core/grid/cell-sets';
import type { Board } from './board';
import type { FlightCandidate, RampFlight } from './model';

/** The pavement components the plaza itself stands against: the network the hub already walks. */
export function hubComponents(board: Board, comp: Int32Array): Set<number> {
  const out = new Set<number>();
  const p = board.hubArea;
  for (let y = p.y - 1; y <= p.y + p.h; y++) {
    for (let x = p.x - 1; x <= p.x + p.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      if (board.paved[i]) out.add(comp[i]!);
    }
  }
  return out;
}

/** Connected components of the pavement: the detached pieces of street the flights join up. */
export function componentsOf(board: Board): {
  comp: Int32Array;
  at(board: Board, c: FlightCandidate, along: number): number;
} {
  const { labels } = labelComponents(board.paved, board.W, board.H);
  const comp = labels.map((label) => label - 1);
  return {
    comp,
    /** The component of the pavement standing at `along` on the flight's line. */
    at(b, c, along) {
      const x = c.axis === 'y' ? c.line : along;
      const y = c.axis === 'y' ? along : c.line;
      if (x < 0 || y < 0 || x >= b.W || y >= b.H) return -1;
      const i = flatIndex(x, y, b.W);
      return b.paved[i] ? comp[i]! : -1;
    },
  };
}

/**
 * Cells the plaza reaches over pavement, with a flight's ramps conducting between its two ends.
 *
 * What conducts is each ramp's own footprint dilated by one cell, not the corridor: the corridor can
 * be a cell wider than the ramps standing in it, and a walk on the finished map crosses only the
 * dilated footprints. Conducting over the wider rect would let this planner call a component
 * reachable that the finished map leaves cut off from the plaza.
 */
export function reachable(board: Board, flights: readonly RampFlight[]): Uint8Array {
  const N = board.W * board.H;
  const conduct = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (board.paved[i]) conduct[i] = 1;
  for (const flight of flights) {
    for (const ramp of flight.ramps) {
      const r = ramp.footprint;
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
          conduct[flatIndex(x, y, board.W)] = 1;
        }
      }
    }
  }
  const ring: number[] = [];
  // The plaza's own ring: any pavement touching the plaza rect.
  for (let y = board.hubArea.y - 1; y <= board.hubArea.y + board.hubArea.h; y++) {
    for (let x = board.hubArea.x - 1; x <= board.hubArea.x + board.hubArea.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      if (conduct[i]) ring.push(i);
    }
  }
  // A hub with no room for a street against it still gets a network. Where the plaza's plate is
  // shaped so that no trunk can be laid along its ring, seeding from the ring alone prunes every
  // street on the planet, and the map comes back with no pavement at all. The largest piece stands in for the hub then, and the pipeline paves the short course from the
  // plaza's own ring out to it, so the finished map is still one network the plaza reaches.
  const seen = floodFrom(ring.length ? ring : largestPiece(board, conduct), (j) => conduct[j] === 1, board.W, board.H);
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (board.paved[i] && seen[i]) out[i] = 1;
  return out;
}

/** The largest 4-connected run of conducting cells, as flat indices. */
function largestPiece(board: Board, conduct: Uint8Array): number[] {
  const { labels, sizes } = labelComponents(conduct, board.W, board.H);
  let best = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k]! > sizes[best]!) best = k;
  const cells: number[] = [];
  if (best > 0) for (let i = 0; i < labels.length; i++) if (labels[i] === best) cells.push(i);
  return cells;
}

/** Paved cells the plaza cannot walk to on the board as it now stands. */
export function stranded(board: Board, flights: readonly RampFlight[]): number {
  const reach = reachable(board, flights);
  let n = 0;
  for (let i = 0; i < board.W * board.H; i++) if (board.paved[i] && !reach[i]) n++;
  return n;
}
