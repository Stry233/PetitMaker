/**
 * Laying the ground a drawing asks for, the assistant's draw_area: what each terrain cell is asked to
 * be by the cells resting on it, the level each water body takes, and the ground built bottom-up.
 * `TerrainDraft` reads every level and decides what each cell may become; a cell it refuses is left
 * as it is and counted, and the rest is laid layer by layer, so one refused layer does not take the
 * others with it. The caller's stroke keeps the result or rolls it back.
 */
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { cellKey } from '../../../core/grid/rect';
import { eraseTerrainCommand, mountainLadder, paintTerrainCommand } from '../../../core/model/command-build';
import { GROUND_SUPPORT_LAYER } from '../../../core/game/profile';
import { TerrainType, type Command, type MacroCoord, type ValidationError } from '../../../core/model/types';
import type { MacroContext } from '../context';
import { TerrainDraft } from './terrain-draft';

/** One drawn mark's ground: land at a level, or water at a stated level or at the lowest ground beside it. */
export type GroundMark = { water: true; level?: number } | { water: false; level: number };

/** What the cells resting on one terrain cell ask of it. */
export interface GroundAsk {
  at: MacroCoord;
  /** The level each standing thing on it stands at, undefined for one with no level of its own. */
  stand: (number | undefined)[];
  /** The ground marks of the cells resting on it that carry no standing thing. */
  ground: GroundMark[];
}

type Target = { kind: 'land'; level: number } | { kind: 'water'; level: number } | { kind: 'keep' };

/** What laying the ground did, in terrain cells. */
interface DrawnGroundReport {
  water: number;
  raised: number;
  flat: number;
  /** Already as drawn. */
  same: number;
  /** Refused by the draft: off buildable ground, under or beside something standing, locked, or a body of water kept as it is. */
  skipped: number;
  /** Cells asked for by standing things at two different levels. */
  clash: number;
  /** The refusals of the layers that did not land. */
  errors: ValidationError[][];
}

/** What each asked cell should become: standing things first (the higher level wins), then the
 *  figure among the drawn ground, the kind `drawn` counts less, water before land and the higher land
 *  on a tie, so a pool in a terrace or a shape of land in a pool keeps its drawn shape. */
function resolveTargets(asks: ReadonlyMap<string, GroundAsk>, drawn: (g: GroundMark) => number): { target: Map<string, Target | { kind: 'water'; level?: number }>; clash: number } {
  const target = new Map<string, Target | { kind: 'water'; level?: number }>();
  let clash = 0;
  for (const [key, ask] of asks) {
    if (ask.stand.length > 0) {
      const levels = ask.stand.filter((l): l is number => l !== undefined);
      if (new Set(levels).size > 1) clash++;
      target.set(key, levels.length > 0 ? { kind: 'land', level: Math.max(...levels) } : { kind: 'keep' });
      continue;
    }
    if (ask.ground.length === 0) continue;
    const rank = (g: GroundMark): number => drawn(g) * 100 + (g.water ? 0 : 50 - g.level);
    const won = ask.ground.reduce((a, b) => (rank(b) < rank(a) ? b : a));
    target.set(key, won.water ? { kind: 'water', ...(won.level === undefined ? {} : { level: won.level }) } : { kind: 'land', level: won.level });
  }
  return { target, clash };
}

/** Gives every water body its one level: the highest it states, else the lowest ground beside it,
 *  drawn or standing now. */
function levelWater(draft: TerrainDraft, asks: ReadonlyMap<string, GroundAsk>, target: Map<string, Target | { kind: 'water'; level?: number }>): void {
  const settled = new Set<string>();
  for (const [key, t] of target) {
    if (t.kind !== 'water' || settled.has(key)) continue;
    const body: string[] = [];
    const queue = [asks.get(key)!.at];
    settled.add(key);
    let stated: number | undefined, lowest = Infinity;
    while (queue.length > 0) {
      const at = queue.pop()!;
      const k = cellKey(at.x, at.y);
      body.push(k);
      const own = target.get(k);
      if (own?.kind === 'water' && own.level !== undefined) stated = Math.max(stated ?? 0, own.level);
      for (const [dx, dy] of NEIGHBORS4) {
        const n = { x: at.x + dx, y: at.y + dy };
        const nk = cellKey(n.x, n.y);
        const next = target.get(nk);
        if (next?.kind === 'water') { if (!settled.has(nk)) { settled.add(nk); queue.push(n); } continue; }
        if (!draft.inside(n)) continue;
        lowest = Math.min(lowest, next?.kind === 'land' ? next.level : draft.level(n));
      }
    }
    const level = stated ?? (Number.isFinite(lowest) ? lowest : 0);
    for (const k of body) target.set(k, { kind: 'water', level });
  }
}

/** Lays the ground `asks` describe, keyed by their terrain cell, with `drawn` counting how much of
 *  each kind of ground the drawing holds. */
export function layDrawnGround(ctx: MacroContext, asks: ReadonlyMap<string, GroundAsk>, drawn: (g: GroundMark) => number): DrawnGroundReport {
  const draft = new TerrainDraft(ctx);
  const { target, clash } = resolveTargets(asks, drawn);
  levelWater(draft, asks, target);
  const report: DrawnGroundReport = { water: 0, raised: 0, flat: 0, same: 0, skipped: 0, clash, errors: [] };
  // The cells the draft takes, with the height each is built up to as land: its own level, or the
  // layer a raised water rests on.
  const changing: { at: MacroCoord; goal: Target; top: number }[] = [];
  for (const [key, goal] of target) {
    if (goal.kind === 'keep') continue;
    const { at } = asks.get(key)!;
    const level = goal.level ?? 0;
    const from = draft.level(at);
    if (!draft.set(at, goal.kind === 'water' ? TerrainType.Water : TerrainType.Mountain, level)) { report.skipped++; continue; }
    if (!draft.cells.has(draft.key(at))) { report.same++; continue; }
    const top = goal.kind === 'land' ? level : level > GROUND_SUPPORT_LAYER && from < level - 1 ? level - 1 : 0;
    changing.push({ at, goal: { kind: goal.kind, level } as Target, top });
  }
  const run = (cells: MacroCoord[], command: (cells: MacroCoord[]) => Command): void => {
    if (cells.length === 0) return;
    const r = ctx.executor.execute(command(cells));
    if (!r.success) report.errors.push(r.errors);
  };
  // A cell lowered to the ground is an erase, which does not bleed onto the shore as a paint does.
  run(changing.filter((c) => c.goal.kind === 'land' && c.top === 0).map((c) => c.at), (cells) => eraseTerrainCommand(cells));
  for (const layer of mountainLadder(changing.filter((c) => c.top > 0), (c) => c.at, () => 0, (c) => c.top)) {
    run(layer.cells, () => layer);
  }
  const waterLevels = [...new Set(changing.filter((c) => c.goal.kind === 'water').map((c) => (c.goal as { level: number }).level))].sort((a, b) => a - b);
  for (const level of waterLevels) {
    const cells = changing.filter((c) => c.goal.kind === 'water' && c.goal.level === level).map((c) => c.at);
    run(cells, (on) => paintTerrainCommand(on, TerrainType.Water, level));
  }
  // Counted by what each cell shows once the layers are down: a refused layer leaves its cells as they were.
  for (const { at, goal } of changing) {
    const now = ctx.state.cells[at.y]?.[at.x]?.terrain;
    if (goal.kind === 'water') { if (now?.type === TerrainType.Water && now.elevation === goal.level) report.water++; }
    else if (goal.kind === 'land' && goal.level > 0) { if (now?.type === TerrainType.Mountain && now.elevation === goal.level) report.raised++; }
    else if (!now || now.type === TerrainType.None) report.flat++;
  }
  return report;
}
