/**
 * Map quality analyzer for the agent's evaluate_map tool: grades the current
 * map on the dimensions the procedural generator treats as design quality
 * (mirrors the probes in design-quality.test.ts). Pure reads — no commands,
 * no mutation. Scores are 0-10 with actionable hints for the LLM.
 */
import { CellZone, ItemCategory, TerrainType, type GridState } from '../core/model/types';
import { objectRect } from '../state/object-geometry';
import { NEIGHBORS4 } from '../core/model/grid-model';
import { categoryOf, getPlaceableByCategory, isDecoration } from '../state/catalog';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { computeLockedCorners } from '../core/edge-cut/trim-lock';
import { roadLookup } from '../state/object-index';
import { detectWaterfalls } from '../core/model/waterfall-geometry';

interface QualityDimension { score: number; hints: string[] }
export interface QualityReport {
  connectivity: QualityDimension;
  terrainInterest: QualityDimension;
  water: QualityDimension;
  buildings: QualityDimension;
  decoration: QualityDimension;
  roads: QualityDimension;
  silhouette: QualityDimension;
}

const clamp10 = (n: number) => Math.max(0, Math.min(10, Math.round(n)));

function connectivity(state: GridState): QualityDimension {
  const { width, height } = state.template;
  // Crossing footprints (+1 apron) let the walk change elevation or cross water.
  const cross = new Set<number>();
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const cat = categoryOf(o);
    if (cat !== ItemCategory.Bridge && cat !== ItemCategory.Ramp) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y) - 1; y <= r.y + r.h; y++)
      for (let x = Math.floor(r.x) - 1; x <= r.x + r.w; x++)
        if (x >= 0 && y >= 0 && x < width && y < height) cross.add(y * width + x);
  }
  const walk = (x: number, y: number): { ok: boolean; e: number } => {
    const c = state.cells[y]?.[x];
    if (!c || c.zone !== CellZone.Grass) return { ok: false, e: -1 };
    if (c.terrain?.type === TerrainType.Water) return { ok: cross.has(y * width + x), e: 0 };
    return { ok: true, e: c.terrain?.elevation ?? 0 };
  };
  // Label connected components over all walkable cells, then measure how much
  // of the LAND belongs to the largest one. Start-point independent: a flood
  // fill from any fixed cell (say the map centre) can start on an isolated
  // plateau and invert the score.
  const isLand = (x: number, y: number): boolean =>
    state.cells[y]![x]!.terrain?.type !== TerrainType.Water;
  const comp = new Int32Array(width * height).fill(-1);
  const landSizes: number[] = [];
  const samples: { x: number; y: number }[] = [];
  let totalLand = 0;
  for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) {
    const si = sy * width + sx;
    if (comp[si] !== -1 || !walk(sx, sy).ok) continue;
    const id = landSizes.length;
    let land = 0;
    let sample: { x: number; y: number } | null = null;
    const q: number[] = [si];
    comp[si] = id;
    while (q.length) {
      const i = q.pop()!;
      const x = i % width, y = (i / width) | 0;
      if (isLand(x, y)) { land++; sample ??= { x, y }; }
      const here = walk(x, y);
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (comp[j] !== -1) continue;
        const there = walk(nx, ny);
        if (!there.ok) continue;
        if (Math.abs(there.e - here.e) >= 1 && !(cross.has(i) || cross.has(j))) continue;
        comp[j] = id;
        q.push(j);
      }
    }
    landSizes.push(land);
    samples.push(sample ?? { x: sx, y: sy });
    totalLand += land;
  }
  let largestId = -1;
  for (let i = 0; i < landSizes.length; i++) if (largestId === -1 || landSizes[i]! > landSizes[largestId]!) largestId = i;
  const largest = largestId >= 0 ? landSizes[largestId]! : 0;
  const cov = totalLand ? largest / totalLand : 1;
  const hints: string[] = [];
  if (cov < 1) {
    // point at the biggest cut-off piece, not an arbitrary one
    let worst = -1;
    for (let i = 0; i < landSizes.length; i++) if (i !== largestId && (worst === -1 || landSizes[i]! > landSizes[worst]!)) worst = i;
    const s = samples[worst]!;
    hints.push(`${totalLand - largest} walkable cells are cut off from the main landmass (largest isolated piece near (${s.x},${s.y})) -- add a ramp or bridge to join them.`);
  }
  return { score: clamp10(cov * 10), hints };
}

function terrainInterest(state: GridState): QualityDimension {
  const { width, height } = state.template;
  const seen = new Set<number>();
  let land = 0, largestFlat = 0;
  const tiers = new Set<number>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = state.cells[y]![x]!;
    if (c.zone !== CellZone.Grass) continue;
    land++;
    if (c.terrain?.type === TerrainType.Mountain) tiers.add(c.terrain.elevation);
    const i = y * width + x;
    if (seen.has(i) || c.terrain?.type === TerrainType.Water) continue;
    // Flood-fill the same-elevation flat expanse.
    const e = c.terrain?.elevation ?? 0;
    let size = 0;
    const fq = [i];
    seen.add(i);
    while (fq.length) {
      const j = fq.pop()!;
      size++;
      const jx = j % width, jy = (j / width) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = ny * width + nx;
        const n = state.cells[ny]![nx]!;
        if (seen.has(k) || n.zone !== CellZone.Grass) continue;
        if (n.terrain?.type === TerrainType.Water) continue;
        if ((n.terrain?.elevation ?? 0) !== e) continue;
        seen.add(k);
        fq.push(k);
      }
    }
    largestFlat = Math.max(largestFlat, size);
  }
  const flatRatio = land ? largestFlat / land : 1;
  const hints: string[] = [];
  if (flatRatio > 0.5) hints.push(`Too flat: largest same-elevation expanse is ${Math.round(flatRatio * 100)}% of the land -- break it up with terraces, cliffs, or water.`);
  if (tiers.size < 2) hints.push(`Only ${tiers.size} mountain tier(s) in use -- professional maps layer 2-4 elevations.`);
  // Score: variety of tiers counts double; reduces flatness penalty weight to balance.
  return { score: clamp10((1 - flatRatio) * 5 + Math.min(tiers.size, 3) * 2), hints };
}

function water(state: GridState): QualityDimension {
  const { width, height } = state.template;
  let cells = 0, elevated = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = state.cells[y]![x]!.terrain;
    if (t?.type !== TerrainType.Water) continue;
    cells++;
    if (t.elevation > 0) elevated++;
  }
  const hints: string[] = [];
  let score = 0;
  if (cells === 0) hints.push('No water anywhere -- a river or lake adds life (carve_river, paint_terrain water).');
  else {
    score = 4 + clamp10((cells / (width * height)) * 60) / 4;
    if (elevated > 0) {
      score += 3;
      if (detectWaterfalls(state).length === 0) {
        hints.push('Elevated water exists but never falls -- chain it down a cliff face into lower water for a waterfall (see alpine-cascade skill).');
      }
    } else {
      hints.push('All water sits at ground level -- an elevated pool feeding a waterfall reads far more dramatic (see pro-terraforming skill).');
    }
  }
  return { score: clamp10(score), hints };
}

/**
 * Silhouette: edge treatment, the finishing pass an expert never skips.
 * Two deterministic proxies for "reads organic vs raw lego":
 *  - what fraction of trimmable convex cliff corners actually carry a trim
 *    (locked corners -- water banks, waterfall frames -- are excluded);
 *  - the longest dead-straight cliff wall (same elevation, same exposed face).
 */
function silhouette(state: GridState): QualityDimension {
  const { width, height } = state.template;
  const roadAt = roadLookup(state);
  const surf = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return -1; // off-map reads lower
    return surfaceElevation(state.cells[y]![x]!.terrain);
  };
  // corner index order matches Corners: [TL, TR, BL, BR]; each corner's two EDGE neighbours
  const CORNER_EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
    [-1, 0, 0, -1], // NW: W, N
    [1, 0, 0, -1],  // NE: E, N
    [-1, 0, 0, 1],  // SW: W, S
    [1, 0, 0, 1],   // SE: E, S
  ];
  let candidates = 0, trimmed = 0;
  let maxRun = 0, runX = -1, runY = -1;
  // horizontal wall runs (exposed north/south faces) per row
  for (let y = 0; y < height; y++) {
    let runN = 0, runS = 0;
    for (let x = 0; x < width; x++) {
      const t = state.cells[y]![x]!.terrain;
      const isCliff = t?.type === TerrainType.Mountain && !t.patchOnly && t.elevation > 0;
      const e = isCliff ? t.elevation : -1;
      runN = isCliff && surf(x, y - 1) < e ? runN + 1 : 0;
      runS = isCliff && surf(x, y + 1) < e ? runS + 1 : 0;
      if (Math.max(runN, runS) > maxRun) { maxRun = Math.max(runN, runS); runX = x; runY = y; }
      if (!isCliff) continue;
      // convex corner census (both edge neighbours strictly lower), minus locked corners
      let locked: readonly boolean[] | null = null;
      const corners = t.corners ?? (['square', 'square', 'square', 'square'] as const);
      for (let k = 0; k < 4; k++) {
        const [ax, ay, bx, by] = CORNER_EDGES[k]!;
        if (surf(x + ax, y + ay) >= e || surf(x + bx, y + by) >= e) continue;
        locked ??= computeLockedCorners(state, roadAt, x, y, 'terrain');
        if (locked[k]) continue;
        candidates++;
        if (corners[k] !== 'square') trimmed++;
      }
    }
  }
  // vertical wall runs (exposed west/east faces) per column
  for (let x = 0; x < width; x++) {
    let runW = 0, runE = 0;
    for (let y = 0; y < height; y++) {
      const t = state.cells[y]![x]!.terrain;
      const isCliff = t?.type === TerrainType.Mountain && !t.patchOnly && t.elevation > 0;
      const e = isCliff ? t.elevation : -1;
      runW = isCliff && surf(x - 1, y) < e ? runW + 1 : 0;
      runE = isCliff && surf(x + 1, y) < e ? runE + 1 : 0;
      if (Math.max(runW, runE) > maxRun) { maxRun = Math.max(runW, runE); runX = x; runY = y; }
    }
  }
  if (candidates === 0 && maxRun < 12) {
    // no cliffs to judge -- neutral, terrainInterest owns the "too flat" complaint
    return { score: 5, hints: [] };
  }
  const trimFrac = candidates > 0 ? trimmed / candidates : 1;
  const wallPenalty = Math.max(0, Math.min(1, (maxRun - 10) / 20));
  const hints: string[] = [];
  if (candidates >= 6 && trimFrac < 0.5) {
    hints.push(`${candidates - trimmed} of ${candidates} convex cliff corners are raw squares -- smooth them (paint_terrain smooth:'round', sculpt_terrace, or trim_corner) so cliffs read organic.`);
  }
  if (maxRun >= 12) {
    hints.push(`A dead-straight cliff wall runs ${maxRun} cells near (${runX},${runY}) -- break it with insets, curves, or a terrace step.`);
  }
  return { score: clamp10(trimFrac * 7 + (1 - wallPenalty) * 3), hints };
}

function buildings(state: GridState): QualityDimension {
  const all = getPlaceableByCategory(ItemCategory.Building);
  const placed = new Set([...state.objects.values()].filter((o) => !o.locked).map((o) => o.catalogId));
  const missing = all.filter((b) => !placed.has(b.id)).map((b) => b.id);
  const hints: string[] = [];
  if (missing.length) hints.push(`Missing ${missing.length} catalog buildings: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}.`);
  return { score: clamp10(((all.length - missing.length) / Math.max(all.length, 1)) * 10), hints };
}

function decoration(state: GridState): QualityDimension {
  const { width, height } = state.template;
  // Count flora and trees per quadrant.
  const quad = [0, 0, 0, 0];
  let total = 0;
  for (const o of state.objects.values()) {
    if (o.locked || !isDecoration(o)) continue;
    total++;
    const qi = (o.position.y >= height / 2 ? 2 : 0) + (o.position.x >= width / 2 ? 1 : 0);
    quad[qi] = (quad[qi] ?? 0) + 1;
  }
  const hints: string[] = [];
  const target = (width * height) / 80; // ~1 decoration per 80 cells per quadrant
  const names = ['NW', 'NE', 'SW', 'SE'];
  quad.forEach((n, i) => {
    if (n < target / 4) hints.push(`${names[i]} quadrant is barely decorated (${n} flora/trees) -- scatter_objects or plant in drifts.`);
  });
  return { score: clamp10((Math.min(...quad) / Math.max(target / 4, 1)) * 6 + Math.min(total / Math.max(target, 1), 1) * 4), hints };
}

function roads(state: GridState): QualityDimension {
  const roadCells = new Set<string>();
  const buildingsArr = [...state.objects.values()].filter(
    (o) => !o.locked && categoryOf(o) === ItemCategory.Building,
  );
  for (const o of state.objects.values()) {
    if (categoryOf(o) === ItemCategory.Road) roadCells.add(`${o.position.x},${o.position.y}`);
  }
  if (buildingsArr.length === 0) return { score: 0, hints: ['No buildings yet, so no road network to judge.'] };
  let connected = 0;
  for (const b of buildingsArr) {
    const r = objectRect(b);
    let near = false;
    outer: for (let y = Math.floor(r.y) - 6; y <= r.y + r.h + 6 && !near; y++)
      for (let x = Math.floor(r.x) - 6; x <= r.x + r.w + 6; x++)
        if (roadCells.has(`${x},${y}`)) { near = true; break outer; }
    if (near) connected++;
  }
  const frac = connected / buildingsArr.length;
  const hints: string[] = [];
  if (frac < 1) hints.push(`${buildingsArr.length - connected} of ${buildingsArr.length} buildings have no road within 6 cells -- build_road to connect them.`);
  return { score: clamp10(frac * 10), hints };
}

export function evaluateMap(state: GridState): QualityReport {
  return {
    connectivity: connectivity(state),
    terrainInterest: terrainInterest(state),
    water: water(state),
    buildings: buildings(state),
    decoration: decoration(state),
    roads: roads(state),
    silhouette: silhouette(state),
  };
}

const DIMENSIONS = [
  'connectivity', 'terrainInterest', 'water', 'buildings', 'decoration', 'roads', 'silhouette',
] as const satisfies readonly (keyof QualityReport)[];

/** Mean of the dimension scores, one decimal. */
export function overallScore(r: QualityReport): number {
  return Math.round((DIMENSIONS.reduce((s, k) => s + r[k].score, 0) / DIMENSIONS.length) * 10) / 10;
}

/**
 * Full scorecard for evaluate_map. With `prev` (the last report of the same
 * session), each changed dimension shows its trend — the error/feedback signal
 * a controller steers by, not just the absolute level.
 */
export function renderScorecard(r: QualityReport, prev?: QualityReport): string {
  const lines = DIMENSIONS.map((k) => {
    const d = r[k];
    const p = prev?.[k]?.score;
    const trend = p !== undefined && p !== d.score ? ` (was ${p}, ${d.score > p ? 'improved' : 'REGRESSED'})` : '';
    const hint = d.hints.length ? `\n  - ${d.hints.join('\n  - ')}` : '';
    return `${k}: ${d.score}/10${trend}${hint}`;
  });
  const overall = overallScore(r);
  const prevOverall = prev ? overallScore(prev) : undefined;
  const overallLine = `OVERALL: ${overall}/10${prevOverall !== undefined && prevOverall !== overall ? ` (was ${prevOverall})` : ''}`;
  return `MAP QUALITY SCORECARD\n${overallLine}\n${lines.join('\n')}\nAddress the lowest-scoring dimension first.`;
}
