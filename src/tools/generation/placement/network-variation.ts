/**
 * ONE MAP, MORE THAN ONE WAY TO PAVE IT: the seeded decisions a road network's shape turns on.
 *
 * The router is deliberate everywhere — the cheapest portal chain, the first node in list order, the
 * lowest cell index on an A* tie — and every one of those decisions is a function of the MAP alone.
 * That is why the whole-map press came out byte-identical at every seed: nothing the seed fed was
 * read by anything that shapes a layout (the two rngs `network.ts` already made drive scenic
 * crossings and roadside planting, and a live-map press does neither).
 *
 * So the seed is given somewhere to land. Four decisions, chosen because each moves the layout
 * without moving what makes it a good one:
 *
 *  - the CORRIDOR FIELD, a smooth cost surface a route pays to cross. Two seeds put their low ground
 *    in different places, so trunks form along different lines. Bounded by `CORRIDOR_COST`: a route
 *    will bend to a cheaper corridor, never take a scenic tour to reach one, since the extra length
 *    is paid at full step cost while the field can only ever discount a fraction of one.
 *  - the CROSSING WEIGHT, which breaks a near-tie between two viable portal chains toward different
 *    ramps or fords. Deterministic per portal within a run: Dijkstra settles a region the moment it
 *    is popped, so a weight that answered twice would corrupt the path it reconstructs.
 *  - the JOIN ORDER of the spanning tree, which decides what the network grows from and therefore
 *    which streets become trunks and which become spurs.
 *  - the ORDER equal candidates are tried in — a crossing site among the sites linking one pair of
 *    regions, a door among the cells a spur may leave a building from.
 *
 * NONE OF IT IS ON BY DEFAULT. Generation runs this same router with its own seed and its output is
 * hash-pinned, so `NetworkOptions.variation` is what turns these on and only the live-map press
 * passes it. Absent, every function here is unreachable and the arithmetic is the classic one.
 */
import type { MacroCoord } from '../../../core/model/types';
import { valueNoise01 } from '../../../core/model/noise';
import { makeRng } from '../../../core/model/rng';
import type { AstarCost } from './network';
import type { Portal, PortalWeight } from './portals';

/** How much of one flat step (`TUNING.roadCost` = 1) the corridor field may add to a cell. A route
 *  of length L can therefore buy at most ~L*CORRIDOR_COST/2 cells of detour, which reads as a street
 *  that chose a different line rather than one that wandered. */
const CORRIDOR_COST = 0.35;
/** Cells per corridor. Wide enough that a route bends toward one rather than jittering cell by cell,
 *  narrow enough that a map holds several. */
const CORRIDOR_SCALE = 9;
/** The share of a portal's own cost the tie-break may add. Small against the gap between a ramp (4)
 *  and a bridge (6), so a seed reorders equals and never prefers the grander crossing. */
const CROSSING_JITTER = 0.4;

/** The seeded decisions, resolved for one run. */
export interface NetworkVariation {
  /** The corridor field, as the A* cost hook. */
  cost: AstarCost;
  /** What one hop of the region graph costs, near-ties broken by seed. */
  weight: PortalWeight;
  /** `items` in a seeded order. `salt` separates one call site's permutation from another's, so the
   *  door a spur leaves by is not tied to the order the spanning tree joined its building. */
  order<T>(items: readonly T[], salt: number): T[];
}

/** A stable [0,1) per portal: its anchor and kind, mixed with the run's seed. */
function portalHash(p: Portal, seed: number): number {
  let h = (p.anchor.x * 374761393 + p.anchor.y * 668265263 + (p.kind === 'bridge' ? 1 : 0) * 2654435761 + seed * 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The run's variation. `road` is the network's own live road set: a cell already paved costs the
 * field nothing, so the reuse discount that collapses redundant links onto existing streets is
 * exactly as strong as it was — the field bends a NEW line, it does not push a route off a standing
 * one.
 */
export function makeNetworkVariation(seed: number, road: ReadonlySet<number>, W: number): NetworkVariation {
  const field = valueNoise01(seed ^ 0x5ea91d);
  const enter = (i: number): number => {
    if (road.has(i)) return 0;
    return CORRIDOR_COST * field((i % W) / CORRIDOR_SCALE, ((i / W) | 0) / CORRIDOR_SCALE);
  };
  return {
    cost: { enter },
    weight: (p: Portal) => p.cost * (1 + CROSSING_JITTER * portalHash(p, seed)),
    order<T>(items: readonly T[], salt: number): T[] {
      const rng = makeRng((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0);
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = out[i]!; out[i] = out[j]!; out[j] = t;
      }
      return out;
    },
  };
}

/** Salts, named so two call sites cannot silently share a permutation. */
export const VARY = {
  joinOrder: 1,
  crossingSite: 2,
  doorSide: 3,
} as const;

/** Where a coordinate list is shuffled, the first entry is often the one a rule names (a gate
 *  approach). Kept in front, the rest reordered. */
export function orderTail(v: NetworkVariation, cells: readonly MacroCoord[], salt: number): MacroCoord[] {
  if (cells.length <= 2) return [...cells];
  return [cells[0]!, ...v.order(cells.slice(1), salt)];
}
