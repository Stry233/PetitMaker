import { NEIGHBORS4 } from '../../../core/grid/directions';
import type { MacroCoord } from '../../../core/model/types';
import { expandLine } from '../../../core/grid/shapes';
import { TerrainDraft } from './terrain-draft';
import { IndexHeap } from '../../../core/base/heap';

/** Cardinal routing follows the drawn guide while leaving room for the selected channel width. */
export function riverPath(draft: TerrainDraft, guide: readonly MacroCoord[], width: number): MacroCoord[] | null {
  const start = guide[0], end = guide[guide.length - 1];
  if (!start || !end || !draft.inside(start) || !draft.inside(end)) return null;
  const size = draft.width * draft.height;
  const floor = draft.level(end);
  const levelAt = (c: MacroCoord): number => Math.max(floor, draft.level(c));
  const distance = new Int32Array(size).fill(size);
  const wave: number[] = [];
  for (const c of guide) if (draft.inside(c) && distance[draft.key(c)] !== 0) {
    distance[draft.key(c)] = 0; wave.push(draft.key(c));
  }
  for (let i = 0; i < wave.length; i++) {
    const key = wave[i]!, c = draft.coord(key);
    for (const [dx, dy] of NEIGHBORS4) {
      const n = { x: c.x + dx, y: c.y + dy }, nk = draft.key(n);
      if (!draft.inside(n) || distance[nk]! <= distance[key]! + 1) continue;
      distance[nk] = distance[key]! + 1; wave.push(nk);
    }
  }

  const usable = new Int8Array(size).fill(-1);
  const canRoute = (c: MacroCoord): boolean => {
    if (c.x < 1 || c.y < 1 || c.x >= draft.width - 1 || c.y >= draft.height - 1) return false;
    const key = draft.key(c);
    if (usable[key] !== -1) return usable[key] === 1;
    const result = expandLine([c], width).every(n => draft.editable(n, levelAt(c))
      && (!draft.water(n) || draft.level(n) >= floor));
    usable[key] = result ? 1 : 0;
    return result;
  };
  if (!canRoute(start) || !canRoute(end)) return null;

  const costs = new Float64Array(size).fill(Infinity), parent = new Int32Array(size).fill(-1);
  const settled = new Uint8Array(size);
  const open = new IndexHeap();
  const startKey = draft.key(start), endKey = draft.key(end);
  costs[startKey] = 0; open.push(0, startKey);
  while (open.size > 0) {
    const key = open.pop();
    if (settled[key]) continue;
    settled[key] = 1;
    const cost = costs[key]!;
    if (key === endKey) {
      const path: MacroCoord[] = [];
      for (let k = endKey; k !== -1; k = parent[k]!) path.push(draft.coord(k));
      return path.reverse();
    }
    const c = draft.coord(key), level = levelAt(c);
    for (const [dx, dy] of NEIGHBORS4) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (!canRoute(n) || levelAt(n) > level) continue;
      const nk = draft.key(n);
      const next = cost + 1 + distance[nk]! * 0.6 + (level - levelAt(n)) * 0.2;
      if (next >= costs[nk]!) continue;
      costs[nk] = next; parent[nk] = key; open.push(next, nk);
    }
  }
  return null;
}
