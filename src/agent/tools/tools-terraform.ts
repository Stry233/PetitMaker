/**
 * Pro-terraforming write tools: organic multi-tier terraces and meandering
 * rivers. Each is ONE stroke group (via runStroke) with an auto edge-cut pass
 * folded into the same undo step, exactly like the build brushes (ATOMIC UNDO).
 */
import { CommandType, TerrainType, type Command, type MacroCoord } from '../../core/model/types';
import { circleCells, lineCells, bezier4, expandLine } from '../../tools/paint';
import { edgeCutGeneratedTerrain } from '../../tools/edge-cut';
import { makeRng } from '../../core/model/rng';
import { type AgentToolDeps, type ToolResultBody, argError, clamp, runStroke } from './tools-common';

/** Organic blob: union of a main circle and two seeded satellite circles. */
function blobCells(cx: number, cy: number, r: number, rng: { float(): number }): MacroCoord[] {
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  const add = (cells: MacroCoord[]) => {
    for (const c of cells) {
      const k = `${c.x},${c.y}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
  };
  add(circleCells({ x: cx, y: cy }, r, r));
  for (let i = 0; i < 2; i++) {
    const ang = rng.float() * Math.PI * 2;
    const dist = Math.max(1, Math.round(r * (0.35 + rng.float() * 0.3)));
    const sr = Math.max(2, Math.round(r * (0.5 + rng.float() * 0.25)));
    add(circleCells({ x: cx + Math.round(Math.cos(ang) * dist), y: cy + Math.round(Math.sin(ang) * dist) }, sr, sr));
  }
  return out;
}

export function sculptTerrace(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const cx = Number(input.cx);
  const cy = Number(input.cy);
  const baseRadius = clamp(Number(input.baseRadius) || 5, 3, 12);
  const tiers = clamp(Number(input.tiers) || 2, 1, 3);
  const smooth = input.smooth === 'rect' ? 'rect' : 'round';
  const seed = Number.isFinite(Number(input.seed)) && input.seed !== undefined ? Number(input.seed) : Math.floor(Math.random() * 99999);
  const rng = makeRng(seed);
  const state = deps.getState();

  // tier blobs, each constrained to the strict interior of the tier below so
  // every upper cell is supported and cliffs get a visible ledge
  const step = Math.max(2, Math.round(baseRadius / (tiers + 0.5)));
  const tierCells: MacroCoord[][] = [];
  for (let L = 0; L < tiers; L++) {
    const r = baseRadius - step * L;
    if (r < 2) break;
    let blob = blobCells(cx, cy, r, rng);
    if (L > 0) {
      const below = new Set(tierCells[L - 1]!.map((c) => `${c.x},${c.y}`));
      blob = blob.filter(
        (c) =>
          below.has(`${c.x},${c.y}`) &&
          below.has(`${c.x + 1},${c.y}`) &&
          below.has(`${c.x - 1},${c.y}`) &&
          below.has(`${c.x},${c.y + 1}`) &&
          below.has(`${c.x},${c.y - 1}`),
      );
    }
    if (blob.length === 0) break;
    tierCells.push(blob);
  }
  const commands: Command[] = tierCells.map((cells, L) => ({
    type: CommandType.PaintTerrain,
    timestamp: Date.now(),
    cells: cells.filter((c) => c.x >= 0 && c.y >= 0 && c.x < state.template.width && c.y < state.template.height),
    terrainType: TerrainType.Mountain,
    elevation: L + 1,
  }));
  const all = tierCells[0] ?? [];
  return runStroke(
    deps,
    commands,
    () => `Sculpted a ${tierCells.length}-tier organic terrace around (${cx},${cy}) (seed ${seed}, ${all.length} base cells, ${smooth} cliffs).`,
    all,
    (exec) => edgeCutGeneratedTerrain({ gridState: state, executeCommand: (c: Command) => exec.execute(c) }, tierCells.flat(), smooth),
  );
}

export function carveRiver(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const points = ((input.points as MacroCoord[] | undefined) ?? []).slice(0, 6);
  if (points.length < 2) {
    return argError('points needs 2-6 waypoints from source to mouth.', 'points: [{"x":8,"y":10},{"x":16,"y":14},{"x":24,"y":12}]');
  }
  const width = clamp(Number(input.width) || 4, 2, 6);
  const smooth = input.smooth === 'rect' ? 'rect' : 'round';
  // smooth polyline: bezier through consecutive midpoints with waypoints as controls
  const path: MacroCoord[] = [];
  if (points.length === 2) {
    path.push(...lineCells(points[0]!, points[1]!, 1));
  } else {
    const mid = (a: MacroCoord, b: MacroCoord): MacroCoord => ({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    let from = points[0]!;
    for (let i = 1; i < points.length - 1; i++) {
      const to = i === points.length - 2 ? points[points.length - 1]! : mid(points[i]!, points[i + 1]!);
      const steps = Math.max(8, Math.abs(to.x - from.x) + Math.abs(to.y - from.y));
      path.push(...bezier4(from, points[i]!, to, steps));
      from = to;
    }
  }
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  // keep a 1-cell margin off the literal map edge: V-WTR-02 treats off-map
  // neighbors as uncapped, so edge-touching water always reverts
  const cells = expandLine(path, width).filter((c) => c.x >= 1 && c.y >= 1 && c.x < mw - 1 && c.y < mh - 1);
  if (cells.length === 0) return argError(`the river path lies entirely off the ${mw}x${mh} map, pass points inside it.`);
  return runStroke(
    deps,
    [{ type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: TerrainType.Water, elevation: 0 }],
    () => `Carved a width-${width} river through ${points.length} waypoint(s) — ${cells.length} water cell(s), ${smooth} banks.`,
    cells,
    (exec) => edgeCutGeneratedTerrain({ gridState: state, executeCommand: (c: Command) => exec.execute(c) }, cells, smooth),
  );
}
