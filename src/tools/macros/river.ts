import { NEIGHBORS4, NEIGHBORS8 } from '../../core/model/grid-model';
import { TerrainType, type AutoEdgeCut, type MacroCoord } from '../../core/model/types';
import { circleCells, expandLine, splinePath, type CurveAnchor } from '../paint/shapes';
import type { MacroContext } from './context';
import { riverPath } from './river-path';
import type { MacroReport } from './run';
import { isWaterAt, surfaceAt } from './terrain';
import { TerrainDraft } from './terrain-draft';

export interface RiverInput {
  from: MacroCoord;
  to: MacroCoord;
  width: number;
  trim?: AutoEdgeCut;
  anchors?: readonly CurveAnchor[];
  region?: readonly MacroCoord[];
}

/** A river ends at the selected destination, including when that destination is above ground. */
export function buildRiver(ctx: MacroContext, input: RiverInput): MacroReport {
  const draft = new TerrainDraft(ctx, input.region);
  const width = Math.max(1, Math.min(5, Math.round(input.width)));
  let guide = splinePath(input.anchors ?? [input.from, input.to]);
  if (draft.level(input.from) < draft.level(input.to)) guide = guide.reverse();
  const path = riverPath(draft, guide, width);
  if (!path || path.length < 2) return { code: 'river-blocked', blocked: [input.from, input.to] };

  const levels: number[] = [];
  const floor = draft.level(path[path.length - 1]!);
  for (const [i, c] of path.entries()) {
    let e = Math.max(floor, draft.level(c), (levels[i - 1] ?? draft.level(c)) - 3);
    // Leave a level neck at an existing pond before beginning a narrower waterfall.
    for (const [dx, dy] of NEIGHBORS4) {
      if (isWaterAt(ctx.state, c.x + dx, c.y + dy)) e = Math.max(e, surfaceAt(ctx.state, c.x + dx, c.y + dy));
    }
    if (i > 0 && e > levels[i - 1]!) return { code: 'river-blocked', blocked: [c] };
    levels.push(e);
  }
  const end = path[path.length - 1]!;
  if (levels[levels.length - 1] !== draft.level(end)) return { code: 'river-blocked', blocked: [end] };

  const channel = new Map<number, { elevation: number; distance: number }>();
  for (const [i, c] of path.entries()) {
    for (const n of expandLine([c], width)) {
      const distance = (n.x - c.x) ** 2 + (n.y - c.y) ** 2;
      const key = draft.key(n), prior = channel.get(key);
      if (!prior || distance < prior.distance) channel.set(key, { elevation: levels[i]!, distance });
    }
  }
  // A waterfall crosses one cardinal row. Diagonal bends must share a level across that row.
  const start = path[0]!;
  const alongX = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const sign = (alongX ? end.x - start.x : end.y - start.y) >= 0 ? 1 : -1;
  const bands = new Map<number, number>();
  const bandOf = (key: number): number => { const c = draft.coord(key); return (alongX ? c.x : c.y) * sign; };
  for (const [key, t] of channel) bands.set(bandOf(key), Math.max(bands.get(bandOf(key)) ?? 0, t.elevation));
  const order = [...bands.keys()].sort((a, b) => a - b);
  for (let i = order.length - 2; i >= 0; i--) bands.set(order[i]!, Math.max(bands.get(order[i]!)!, bands.get(order[i + 1]!)!));
  for (let i = 1; i < order.length; i++) bands.set(order[i]!, Math.max(bands.get(order[i]!)!, bands.get(order[i - 1]!)! - 3));
  for (const [key, t] of channel) t.elevation = bands.get(bandOf(key))!;
  for (const [key, { elevation }] of channel) draft.set(draft.coord(key), TerrainType.Water, elevation);
  // Dry endpoints receive a small pool; joins keep the existing body's outline.
  for (const c of [path[0]!, end]) {
    if (isWaterAt(ctx.state, c.x, c.y)) continue;
    const e = draft.level(c);
    const radius = Math.max(1, Math.ceil(width / 2));
    for (const n of circleCells(c, radius, radius)) {
      if (draft.level(n) <= e && (!draft.water(n) || draft.level(n) === e)) draft.set(n, TerrainType.Water, e);
    }
  }
  const success = draft.blocked.size === 0 && frameFalls(draft) && recedeBanks(draft) && draft.contain() && draft.commit(input.trim);
  return success ? {} : { code: 'river-blocked', blocked: [...draft.blocked.values()] };
}

/** A receiving row can remove the footing under an existing cliff beside a diagonal fall. Recede
 *  that dry flank while keeping the channel, caps and receiving rows at their planned heights. */
function recedeBanks(draft: TerrainDraft): boolean {
  const fixed = new Set(draft.cells.keys());
  const queue = [...draft.cells].filter(([key, t]) => {
    const c = draft.coord(key);
    return t.elevation < surfaceAt(draft.ctx.state, c.x, c.y);
  }).map(([key]) => key);
  for (let i = 0; i < queue.length; i++) {
    const c = draft.coord(queue[i]!), ceiling = draft.level(c) + 3;
    for (const [dx, dy] of NEIGHBORS8) {
      const n = { x: c.x + dx, y: c.y + dy }, key = draft.key(n);
      if (draft.water(n) || draft.level(n) <= ceiling) continue;
      if (fixed.has(key) || !draft.set(n, TerrainType.Mountain, ceiling)) return draft.refuse(n);
      queue.push(key);
    }
  }
  return true;
}

function frameFalls(draft: TerrainDraft): boolean {
  const faces = new Set<string>();
  for (const [key, t] of [...draft.cells]) {
    if (t.type !== TerrainType.Water) continue;
    const c = draft.coord(key), e = t.elevation;
    for (const [dx, dy] of NEIGHBORS4) {
      const next = { x: c.x + dx, y: c.y + dy }, lower = draft.level(next);
      if (!draft.water(next) || lower >= e) continue;
      const px = -dy, py = dx;
      const strip: MacroCoord[] = [c];
      for (const sign of [-1, 1]) {
        let n = { x: c.x + px * sign, y: c.y + py * sign };
        while (draft.water(n) && draft.level(n) === e) {
          strip.push(n); n = { x: n.x + px * sign, y: n.y + py * sign };
        }
        if (draft.water(n) || !draft.set(n, TerrainType.Mountain, e)) return draft.refuse(n);
        strip.push(n);
      }
      const face = `${Math.min(...strip.map(n => draft.key(n)))},${dx},${dy}`;
      if (faces.has(face)) continue;
      faces.add(face);
      for (const n of strip) {
        const receiver = { x: n.x + dx, y: n.y + dy };
        if (!draft.set(receiver, draft.water(receiver) ? TerrainType.Water : TerrainType.Mountain, lower)) return false;
        if (draft.water(n)) draft.openFall(n, dx, dy);
      }
    }
  }
  return true;
}
