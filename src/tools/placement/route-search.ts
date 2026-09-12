import { NEIGHBORS4 } from '../../core/model/grid-model';
import type { MacroCoord } from '../../core/model/types';
import { NodeHeap } from './node-heap';
import type { Portal } from './portals';

export interface RouteJump {
  from: MacroCoord;
  to: MacroCoord;
  near: MacroCoord[];
  far: MacroCoord[];
  portal: Portal;
}
export interface RouteStep { at: MacroCoord; jump?: RouteJump }

/** When travel cost ties, prefer a shorter structure over a longer deck. */
const SPAN_PREMIUM = 0.15;

/** Crossing links compete with ordinary walking in the same search. Direction belongs to the
 *  search state: reaching a cell from another side can avoid a bend at the next bridge or ramp. */
export function searchCrossings(
  start: MacroCoord, goal: MacroCoord, width: number, height: number,
  passable: (x: number, y: number) => boolean,
  stepCost: (from: MacroCoord, to: MacroCoord, direction: readonly [number, number] | null) => number,
  jumps: readonly RouteJump[], minStep: number,
): RouteStep[] | null {
  const count = width * height * 5;
  const costs = new Float64Array(count).fill(Infinity), parents = new Int32Array(count).fill(-1);
  const via = new Map<number, RouteJump>(), outgoing = new Map<number, RouteJump[]>();
  const index = (c: MacroCoord): number => c.y * width + c.x;
  const coord = (id: number): MacroCoord => ({ x: id % width, y: Math.floor(id / width) });
  for (const jump of jumps) {
    const at = index(jump.from), list = outgoing.get(at) ?? [];
    list.push(jump); outgoing.set(at, list);
  }
  const heuristic = (c: MacroCoord): number => (Math.abs(c.x - goal.x) + Math.abs(c.y - goal.y)) * minStep;
  const first = index(start) * 5 + 4, last = index(goal), heap = new NodeHeap();
  const settled = new Uint8Array(count);
  costs[first] = 0; heap.push(heuristic(start), first);
  while (heap.size) {
    const current = heap.pop();
    if (settled[current]) continue;
    settled[current] = 1;
    const cell = Math.floor(current / 5), at = coord(cell), heading = current % 5;
    if (cell === last) {
      const steps: RouteStep[] = [];
      for (let id = current; id >= 0; id = parents[id]!) steps.push({ at: coord(Math.floor(id / 5)), jump: via.get(id) });
      return steps.reverse();
    }
    const enter = heading === 4 ? null : NEIGHBORS4[heading]!;
    const offer = (to: MacroCoord, dir: number, price: number, jump?: RouteJump): void => {
      const id = index(to) * 5 + dir, cost = costs[current]! + price;
      if (cost >= costs[id]!) return;
      costs[id] = cost; parents[id] = current;
      if (jump) via.set(id, jump); else via.delete(id);
      heap.push(cost + heuristic(to), id);
    };
    for (let dir = 0; dir < NEIGHBORS4.length; dir++) {
      const [dx, dy] = NEIGHBORS4[dir]!, to = { x: at.x + dx, y: at.y + dy };
      if (passable(to.x, to.y)) offer(to, dir, stepCost(at, to, enter));
    }
    for (const jump of outgoing.get(cell) ?? []) {
      const dx = Math.sign(jump.to.x - at.x), dy = Math.sign(jump.to.y - at.y);
      const direction = NEIGHBORS4.findIndex(d => d[0] === dx && d[1] === dy);
      if (direction < 0) continue;
      const next = { x: at.x + dx, y: at.y + dy };
      const span = Math.abs(jump.to.x - at.x) + Math.abs(jump.to.y - at.y);
      offer(jump.to, direction, span - 1 + stepCost(at, next, enter) + jump.portal.cost + span * SPAN_PREMIUM, jump);
    }
  }
  return null;
}
