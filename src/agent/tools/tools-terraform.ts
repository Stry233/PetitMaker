/**
 * Pro-terraforming write tools: organic multi-tier terraces and meandering
 * rivers. Each is ONE stroke group (via runStroke) with an auto edge-cut pass
 * folded into the same undo step, exactly like the build brushes (ATOMIC UNDO).
 */
import { CellZone, CommandType, TerrainType, type Command, type MacroCoord } from '../../core/model/types';
import { circleCells, lineCells, bezier4, expandLine } from '../../tools/paint';
import { edgeCutGeneratedTerrain } from '../../tools/edge-cut';
import { makeRng } from '../../core/model/rng';
import { type AgentToolDeps, type ToolResultBody, argError, clamp, clipBuildable, clipOccupied, runStroke } from './tools-common';

/**
 * The armed region as a membership test, or null with none armed. The organic generators CLIP what
 * they grow to it: the spread is the TOOL's choice rather than the model's, so a whole-call
 * refusal over cells the model never asked for teaches nothing and costs a turn. Coordinates the
 * model chooses itself (waypoints, centers, every other tool's cells) stay under the stroke
 * runners' all-or-nothing region rule.
 */
export function regionClip(deps: AgentToolDeps): Set<string> | null {
  const region = deps.getRegion();
  if (region.length === 0) return null;
  return new Set(region.map((c) => `${c.x},${c.y}`));
}

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
  // The default seed comes from the site itself: the same terrace at the same spot replays
  // exactly, and a terrace elsewhere draws its own shape.
  const seed = Number.isFinite(Number(input.seed)) && input.seed !== undefined ? Number(input.seed) : ((cx * 7919 + cy * 104729 + baseRadius * 31) | 0);
  const rng = makeRng(seed);
  const state = deps.getState();

  // tier blobs, each constrained to the strict interior of the tier below so
  // every upper cell is supported and cliffs get a visible ledge
  const step = Math.max(2, Math.round(baseRadius / (tiers + 0.5)));
  const clip = regionClip(deps);
  let clippedAny = false;
  const tierCells: MacroCoord[][] = [];
  for (let L = 0; L < tiers; L++) {
    const r = baseRadius - step * L;
    if (r < 2) break;
    let blob = clipBuildable(blobCells(cx, cy, r, rng), state).cells;
    if (clip) {
      const kept = blob.filter((c) => clip.has(`${c.x},${c.y}`));
      if (kept.length < blob.length) clippedAny = true;
      blob = kept;
    }
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
  if (clip && (tierCells[0]?.length ?? 0) === 0) {
    return argError('the terrace footprint lies entirely outside the selected region, move cx,cy inside it.');
  }
  const all = tierCells[0] ?? [];
  const clipNote = clippedAny ? ', clipped to the selected region' : '';
  return runStroke(
    deps,
    commands,
    () => `Sculpted a ${tierCells.length}-tier organic terrace around (${cx},${cy}) (seed ${seed}, ${all.length} base cells, ${smooth} cliffs${clipNote}).`,
    all,
    (exec) => edgeCutGeneratedTerrain({ gridState: state, executeCommand: (c: Command) => exec.execute(c) }, tierCells.flat(), smooth),
  );
}

/**
 * The expert maps' PRIMARY form in one call: a banded backing wall (the reference planet's north
 * wall). Bands rise +3 per step with every higher band inset 2 cells on ALL sides — the stepping
 * V-MTN-03 accepts by construction — the crest stays flat, and `flood` sinks a crest pool inside a
 * 1-cell ring of the crest's own mountain. One stroke, edge-cut like the build brushes.
 */
export function sculptWall(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  let ix1 = Number(input.x1), iy1 = Number(input.y1), ix2 = Number(input.x2), iy2 = Number(input.y2);
  const edge = input.edge === 'N' || input.edge === 'S' || input.edge === 'E' || input.edge === 'W' ? input.edge : undefined;
  if (edge) {
    // The convenience siting: a wall IS a boundary condition, so `edge` derives the rect from the
    // buildable grass bounds itself — abutting the named edge, spanning it, `depth` rows deep. A
    // wall placed by eye landed mid-field with grass showing behind it, which reads as a
    // picture-frame pond rather than the map's far wall.
    let gx1 = mw, gy1 = mh, gx2 = -1, gy2 = -1;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      if (state.cells[y]![x]!.zone === CellZone.Grass) {
        if (x < gx1) gx1 = x; if (x > gx2) gx2 = x; if (y < gy1) gy1 = y; if (y > gy2) gy2 = y;
      }
    }
    if (gx2 < gx1) return argError('the map has no buildable grass to stand a wall on.');
    const depth = clamp(Number(input.depth) || 14, 7, 30);
    if (edge === 'N') { ix1 = gx1; ix2 = gx2; iy1 = gy1; iy2 = gy1 + depth - 1; }
    else if (edge === 'S') { ix1 = gx1; ix2 = gx2; iy2 = gy2; iy1 = gy2 - depth + 1; }
    else if (edge === 'W') { iy1 = gy1; iy2 = gy2; ix1 = gx1; ix2 = gx1 + depth - 1; }
    else { iy1 = gy1; iy2 = gy2; ix2 = gx2; ix1 = gx2 - depth + 1; }
  }
  const x1 = clamp(Math.min(ix1, ix2) || 0, 0, mw - 1);
  const x2 = clamp(Math.max(ix1, ix2) || 0, 0, mw - 1);
  const y1 = clamp(Math.min(iy1, iy2) || 0, 0, mh - 1);
  const y2 = clamp(Math.max(iy1, iy2) || 0, 0, mh - 1);
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return argError('sculpt_wall needs the band rect corners x1,y1,x2,y2, or edge ("N"|"S"|"E"|"W") with depth.', 'edge: "N", depth: 14, crest: 8, flood: true');
  }
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  if (w < 7 || h < 7) return argError(`the wall band is ${w}x${h}; it needs at least 7 cells on each side for one inset step.`);
  const askedCrest = clamp(Number(input.crest) || 6, 2, 8);
  // Bands at 3, 6, 8 up to the crest; each +1 band needs 2 more cells of inset per side.
  const ladder = [3, 6, 8].filter((e) => e <= askedCrest);
  if (ladder.length === 0 || ladder[ladder.length - 1]! !== askedCrest) ladder.push(askedCrest);
  const maxBands = Math.max(1, Math.floor((Math.min(w, h) - 3) / 4) + 1);
  const bands = ladder.slice(0, maxBands);
  const crest = bands[bands.length - 1]!;
  const flood = input.flood === true;
  const clip = regionClip(deps);

  // Final elevation per cell (the highest band covering it), then the paint ladder bottom-up so
  // every tier stands on the one below.
  const finalElev = new Map<string, number>();
  bands.forEach((e, i) => {
    const inset = i * 2;
    for (let y = y1 + inset; y <= y2 - inset; y++) {
      for (let x = x1 + inset; x <= x2 - inset; x++) {
        if (clip && !clip.has(`${x},${y}`)) continue;
        if (state.cells[y]?.[x]?.zone !== CellZone.Grass) continue;
        finalElev.set(`${x},${y}`, e);
      }
    }
  });
  if (finalElev.size === 0) return argError('the wall band lies entirely outside the selected region, move the rect inside it.');
  const commands: Command[] = [];
  for (let e = 1; e <= crest; e++) {
    const cells: MacroCoord[] = [];
    for (const [k, fe] of finalElev) {
      if (fe < e) continue;
      const [cx, cy] = k.split(',').map(Number);
      cells.push({ x: cx!, y: cy! });
    }
    if (cells.length > 0) commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: TerrainType.Mountain, elevation: e });
  }
  const crestInset = (bands.length - 1) * 2;
  let poolCells: MacroCoord[] = [];
  if (flood) {
    for (let y = y1 + crestInset + 1; y <= y2 - crestInset - 1; y++) {
      for (let x = x1 + crestInset + 1; x <= x2 - crestInset - 1; x++) {
        if (finalElev.get(`${x},${y}`) === crest) poolCells.push({ x, y });
      }
    }
    poolCells = poolCells.filter((c) => !clip || clip.has(`${c.x},${c.y}`));
    if (poolCells.length > 0) commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells: poolCells, terrainType: TerrainType.Water, elevation: crest });
  }
  const smooth = input.smooth === 'rect' ? 'rect' : 'round';
  const mountainCells = [...finalElev.keys()].map((k) => { const [cx, cy] = k.split(',').map(Number); return { x: cx!, y: cy! }; });
  return runStroke(
    deps,
    commands,
    () => `Raised a ${bands.length}-band wall (${w}x${h}, crest elevation ${crest}${crest < askedCrest ? `, lowered from ${askedCrest} to fit the band's depth` : ''}${flood ? `, crest pool ${poolCells.length} cells` : ''}). The crest is flat and pavable.`,
    mountainCells,
    (exec) => edgeCutGeneratedTerrain({ gridState: state, executeCommand: (c: Command) => exec.execute(c) }, mountainCells, smooth),
  );
}

/**
 * Build a raised bench and its contained pool in one legal stroke. `islets:true` keeps a step-three
 * lattice of bench cells inside the water for a matching `scatter_objects` grid.
 */
export function sinkPool(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  const ix1 = Number(input.x1), iy1 = Number(input.y1), ix2 = Number(input.x2), iy2 = Number(input.y2);
  if (![ix1, iy1, ix2, iy2].every(Number.isFinite)) {
    return argError('sink_pool needs the pool rect corners x1,y1,x2,y2.', 'x1: 20, y1: 30, x2: 34, y2: 40, elevation: 1');
  }
  // 1-cell margin off the literal map edge: V-WTR-02 treats off-map neighbors as uncapped.
  const x1 = clamp(Math.min(ix1, ix2), 1, mw - 2), x2 = clamp(Math.max(ix1, ix2), 1, mw - 2);
  const y1 = clamp(Math.min(iy1, iy2), 1, mh - 2), y2 = clamp(Math.max(iy1, iy2), 1, mh - 2);
  const w = x2 - x1 + 1, h = y2 - y1 + 1;
  if (w < 5 || h < 5) return argError(`the pool rect is ${w}x${h}; it needs at least 5 cells each way for a 1-cell rim around 3x3 of water.`);
  // Capped at 3: a sheer bench taller than one band step is what V-MTN-03 refuses.
  const elevation = clamp(Number(input.elevation) || 1, 1, 3);
  const islets = input.islets === true;
  const clip = regionClip(deps);
  const inRect: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    if (clip && !clip.has(`${x},${y}`)) continue;
    inRect.push({ x, y });
  }
  if (inRect.length === 0) return argError('the pool rect lies entirely outside the selected region, move it inside.');
  const commands: Command[] = [];
  // The bench ladder bottom-up, every tier standing on the one below.
  for (let e = 1; e <= elevation; e++) {
    commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells: inRect, terrainType: TerrainType.Mountain, elevation: e });
  }
  const water = inRect.filter((c) => {
    if (c.x === x1 || c.x === x2 || c.y === y1 || c.y === y2) return false;
    if (islets && (c.x - x1 - 2) % 3 === 0 && (c.y - y1 - 2) % 3 === 0 && c.x >= x1 + 2 && c.y >= y1 + 2 && c.x <= x2 - 2 && c.y <= y2 - 2) return false;
    return true;
  });
  const isletCount = inRect.length - water.length - (2 * w + 2 * h - 4);
  commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells: water, terrainType: TerrainType.Water, elevation });
  const smooth = input.smooth === 'rect' ? 'rect' : 'round';
  return runStroke(
    deps,
    commands,
    () => `Sunk a ${w}x${h} pool court at elevation ${elevation}: ${water.length} water cell(s) inside a 1-cell bench rim${islets ? `, ${Math.max(0, isletCount)} islet(s) on the step-3 lattice (scatter_objects pattern "grid" step 3 plants the parterre)` : ''}.`,
    inRect,
    (exec) => edgeCutGeneratedTerrain({ gridState: state, executeCommand: (c: Command) => exec.execute(c) }, inRect, smooth),
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
  const inBounds = expandLine(path, width).filter((c) => c.x >= 1 && c.y >= 1 && c.x < mw - 1 && c.y < mh - 1);
  if (inBounds.length === 0) return argError(`the river path lies entirely off the ${mw}x${mh} map, pass points inside it.`);
  const clip = regionClip(deps);
  const zoned = clipOccupied(clipBuildable(inBounds, state).cells, state).cells;
  const cells = clip ? zoned.filter((c) => clip.has(`${c.x},${c.y}`)) : zoned;
  if (cells.length === 0) return argError('the river path lies entirely outside the selected region or the buildable grass zone, pass points inside it.');
  const clipNote = cells.length < inBounds.length ? ', clipped to the selected region' : '';
  return runStroke(
    deps,
    [{ type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: TerrainType.Water, elevation: 0 }],
    () => `Carved a width-${width} river through ${points.length} waypoint(s) — ${cells.length} water cell(s), ${smooth} banks${clipNote}.`,
    cells,
    (exec) => edgeCutGeneratedTerrain({ gridState: state, executeCommand: (c: Command) => exec.execute(c) }, cells, smooth),
  );
}
