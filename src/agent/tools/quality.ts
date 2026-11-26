/**
 * Map quality analyzer for the agent's evaluate_map tool: grades the current
 * map on the dimensions the procedural generator treats as design quality
 * (mirrors the probes in design-quality.slow.test.ts). Pure reads, no commands and
 * no mutation; it scores through the map readings in `tools/reading`, which the generator shares.
 * Scores are 0-10 with actionable hints for the LLM.
 */
import { TerrainType, type GridState } from '../../core/model/types';
import { objectRect } from '../../state/object-geometry';
import { getPlaceableByRole, isDecoration, getCatalogItem, roleOf } from '../../state/catalog';
import { surfaceElevation } from '../../core/domain/terrain/terrain-surface';
import { computeLockedCorners } from '../../core/domain/edge-cut/trim-lock';
import { roadLookup } from '../../state/object-index';
import { detectWaterfalls } from '../../core/domain/terrain/waterfall-geometry';
import { isCoatingItem, isCrossing } from '../../core/model/traits';
import { SQUARE_CORNERS } from '../../core/model/corners';
import { readMap, type MapMasks } from '../../tools/reading';
import { cellKey } from '../../core/grid/rect';
import { labelComponents } from '../../core/grid/cell-sets';
import { BUILDABLE_ZONES } from './game-terms';

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

interface SpeckleFinding { rect: string; n: number; why: string }

/**
 * The planting clusters that read as noise (scattered with no row, grid or solid fill, species-mixed,
 * an elongated flower band, or a lone flower dot), each named as a rect to clear or replant as one
 * bed. Region tokens show occupancy, not disorder, so the find_speckle sweep and the evaluator's
 * decoration grade both read this detector.
 */
export function speckleFindings(state: GridState): { findings: SpeckleFinding[]; plantCount: number } {
  const plants = [...state.objects.values()].filter((o) => !o.locked && isDecoration(o));
  if (plants.length === 0) return { findings: [], plantCount: 0 };
  // Chebyshev-2 clustering: near plants belong to one patch.
  const parent = new Map<number, number>();
  const find = (a: number): number => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(a, r); return r; };
  plants.forEach((_, i) => parent.set(i, i));
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const dx = Math.abs(plants[i]!.position.x - plants[j]!.position.x);
      const dy = Math.abs(plants[i]!.position.y - plants[j]!.position.y);
      if (Math.max(dx, dy) <= 2) { const ri = find(i), rj = find(j); if (ri !== rj) parent.set(ri, rj); }
    }
  }
  const groups = new Map<number, number[]>();
  plants.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });
  const findings: SpeckleFinding[] = [];
  for (const members of groups.values()) {
    if (members.length < 4) {
      // A lone, paired or tripled tree is a specimen moment; flowers that small are strays — a
      // flower reads as part of a bed or ribbon, and a detached pink pair floats as noise.
      if (members.some((i) => roleOf(plants[i]!) === 'groundcover')) {
        const p = plants[members[0]!]!.position;
        findings.push({
          rect: members.length === 1 ? `(${p.x},${p.y})` : `(${Math.min(...members.map((i) => plants[i]!.position.x))},${Math.min(...members.map((i) => plants[i]!.position.y))})-(${Math.max(...members.map((i) => plants[i]!.position.x))},${Math.max(...members.map((i) => plants[i]!.position.y))})`,
          n: members.length,
          why: members.length === 1
            ? 'a lone flower dot — a specimen is a tree; give it a bed or remove it'
            : `${members.length} stray dot(s) with no parent bed — fold them into a bed or ribbon, or remove them`,
        });
      }
      continue;
    }
    const xs = members.map((i) => plants[i]!.position.x);
    const ys = members.map((i) => plants[i]!.position.y);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const w = x2 - x1 + 1, h = y2 - y1 + 1;
    const area = w * h;
    const counts = new Map<string, number>();
    for (const i of members) { const id = plants[i]!.catalogId; counts.set(id, (counts.get(id) ?? 0) + 1); }
    const solid = members.length / area >= 0.5;
    const oneLine = x1 === x2 || y1 === y2;
    // A lattice: some pitch 2-3 puts nearly every member on its grid points.
    const onGrid = [2, 3].some((p) => members.every((i) => (plants[i]!.position.x - x1) % p === 0 && (plants[i]!.position.y - y1) % p === 0));
    const ordered = solid || oneLine || onGrid;
    // Two species is legal as a grain (one dominant, a sparse accent); interleaved near-parity
    // reads as confetti in both dialects, and three or more always does.
    const minority = members.length - Math.max(...counts.values());
    const mixed = counts.size > 2 || (counts.size === 2 && members.length >= 8 && minority / members.length >= 0.35);
    // An elongated flower band wider than a ribbon is a fill even when it is perfectly solid:
    // edging is 1-2 cells wide on the built-in planets, and a 4-cell-thick bank strip reads as painted
    // ground. A broad panel (a flower field) is a legitimate block, so only bands 3x as long as
    // they are wide count.
    const allFlora = members.every((i) => roleOf(plants[i]!) === 'groundcover');
    const wideBed = solid && allFlora && isBroadBand(w, h);
    // A lattice the size of a district is wallpaper, not an orchard: the reference bounds an
    // orchard to one court (~6x8) beside the homes it belongs to.
    const wallpaper = onGrid && !allFlora && area >= 300;
    if (ordered && !mixed && !wideBed && !wallpaper) continue;
    const why = [
      ...(!ordered ? ['scattered (no fill, row or lattice)'] : []),
      ...(mixed ? [counts.size > 2 ? `${counts.size} species mixed` : 'two species interleaved near-parity'] : []),
      ...(wideBed ? [`a ${w}x${h} solid flower band — edging is 1-2 cells wide, this reads as a fill`] : []),
      ...(wallpaper ? [`a ${w}x${h} orchard lattice blankets the district — the reference bounds an orchard to a court (~6x8); keep 2-3 bounded patches and clear the rest`] : []),
    ].join(', ');
    findings.push({ rect: `(${x1},${y1})-(${x2},${y2})`, n: members.length, why });
  }
  findings.sort((a, b) => b.n - a.n);
  return { findings, plantCount: plants.length };
}

/** A planting rectangle at least three cells thick, twelve long and three times as long as it is
 *  wide: a band that reads as a painted fill rather than edging or a broad bed. */
export function isBroadBand(w: number, h: number): boolean {
  return Math.min(w, h) >= 3 && Math.max(w, h) >= 12 && Math.max(w, h) >= 3 * Math.min(w, h);
}

function connectivity(state: GridState, g: MapMasks): QualityDimension {
  const { W, H } = g;
  // Crossing footprints (+1 apron) let the walk change elevation or cross water.
  const cross = new Uint8Array(W * H);
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    if (!isCrossing(getCatalogItem(o.catalogId))) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y) - 1; y <= r.y + r.h; y++)
      for (let x = Math.floor(r.x) - 1; x <= r.x + r.w; x++)
        if (x >= 0 && y >= 0 && x < W && y < H) cross[y * W + x] = 1;
  }
  // Walkable: buildable ground, and water only where a crossing spans it, which the walk treats as level 0.
  const walkable = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) walkable[i] = g.land[i] && (!g.water[i] || cross[i]) ? 1 : 0;
  const level = (i: number): number => (g.water[i] ? 0 : g.elev[i]!);
  // Components over every walkable cell, so the score does not depend on where a walk starts: a
  // flood from a fixed cell can start on an isolated plateau and invert it.
  const { labels, sizes } = labelComponents(walkable, W, H, false, (i, j) => level(i) === level(j) || !!cross[i] || !!cross[j]);
  const landSizes = new Array<number>(sizes.length).fill(0);
  const samples: ({ x: number; y: number } | undefined)[] = new Array(sizes.length).fill(undefined);
  for (let i = 0; i < W * H; i++) {
    const id = labels[i]!;
    if (!id || g.water[i]) continue;
    landSizes[id]!++;
    samples[id] ??= { x: i % W, y: (i / W) | 0 };
  }
  let totalLand = 0, largestId = -1;
  for (let id = 1; id < sizes.length; id++) {
    totalLand += landSizes[id]!;
    if (largestId === -1 || landSizes[id]! > landSizes[largestId]!) largestId = id;
  }
  const largest = largestId >= 0 ? landSizes[largestId]! : 0;
  const cov = totalLand ? largest / totalLand : 1;
  const hints: string[] = [];
  if (cov < 1) {
    // point at the biggest cut-off piece, not an arbitrary one
    let worst = -1;
    for (let id = 1; id < sizes.length; id++) if (id !== largestId && (worst === -1 || landSizes[id]! > landSizes[worst]!)) worst = id;
    const s = samples[worst]!;
    hints.push(`${totalLand - largest} walkable cells are cut off from the main landmass (largest isolated piece near (${s.x},${s.y})) -- add a ramp or bridge to join them.`);
  }
  return { score: clamp10(cov * 10), hints };
}

function terrainInterest(g: MapMasks): QualityDimension {
  const { W, H } = g;
  const tiers = new Set<number>();
  const dry = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!g.land[i]) continue;
    if (g.mountain[i]) tiers.add(g.elev[i]!);
    if (!g.water[i]) dry[i] = 1;
  }
  // The same-elevation flat expanses: dry buildable ground joined at equal height.
  const { sizes } = labelComponents(dry, W, H, false, (i, j) => g.elev[i] === g.elev[j]);
  const largestFlat = sizes.reduce((most, n, id) => (id > 0 && n > most ? n : most), 0);
  const flatRatio = g.landCells ? largestFlat / g.landCells : 1;
  const hints: string[] = [];
  if (flatRatio > 0.5) hints.push(`Too flat: largest same-elevation expanse is ${Math.round(flatRatio * 100)}% of the land -- break it up with terraces, cliffs, or water.`);
  if (tiers.size < 2) hints.push(`Only ${tiers.size} mountain tier(s) in use -- professional maps layer 2-4 elevations.`);
  // Score: variety of tiers counts double; reduces flatness penalty weight to balance.
  return { score: clamp10((1 - flatRatio) * 5 + Math.min(tiers.size, 3) * 2), hints };
}

function water(state: GridState, g: MapMasks): QualityDimension {
  const { width, height } = state.template;
  let cells = 0, elevated = 0;
  for (let i = 0; i < g.W * g.H; i++) {
    if (!g.water[i]) continue;
    cells++;
    if (g.elev[i]! > 0) elevated++;
  }
  const hints: string[] = [];
  let score = 0;
  if (cells === 0) hints.push('No water anywhere -- a river or lake adds life (carve_river, paint_terrain water).');
  else {
    score = 4 + clamp10((cells / (width * height)) * 60) / 4;
    if (elevated > 0) {
      score += 3;
      if (detectWaterfalls(state).length === 0) {
        hints.push('Elevated water exists but never falls -- chain it down a cliff face into lower water for a waterfall (see the pro-terraforming skill).');
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
  // corner index order matches Corners: [TL, TR, BL, BR]; each corner's two edge neighbours
  const CORNER_EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
    [-1, 0, 0, -1], // NW: W, N
    [1, 0, 0, -1],  // NE: E, N
    [-1, 0, 0, 1],  // SW: W, S
    [1, 0, 0, 1],   // SE: E, S
  ];
  let candidates = 0, trimmed = 0;
  let maxRun = 0;
  // horizontal wall runs (exposed north/south faces) per row
  for (let y = 0; y < height; y++) {
    let runN = 0, runS = 0;
    for (let x = 0; x < width; x++) {
      const t = state.cells[y]![x]!.terrain;
      const isCliff = t?.type === TerrainType.Mountain && !t.patchOnly && t.elevation > 0;
      const e = isCliff ? t.elevation : -1;
      runN = isCliff && surf(x, y - 1) < e ? runN + 1 : 0;
      runS = isCliff && surf(x, y + 1) < e ? runS + 1 : 0;
      maxRun = Math.max(maxRun, runN, runS);
      if (!isCliff) continue;
      // convex corner census (both edge neighbours strictly lower), minus locked corners
      let locked: readonly boolean[] | null = null;
      const corners = t.corners ?? SQUARE_CORNERS;
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
      maxRun = Math.max(maxRun, runW, runE);
    }
  }
  if (candidates === 0 && maxRun < 12) {
    // no cliffs to judge -- neutral, terrainInterest owns the "too flat" complaint
    return { score: 5, hints: [] };
  }
  const trimFrac = candidates > 0 ? trimmed / candidates : 1;
  const wallPenalty = Math.max(0, Math.min(1, (maxRun - 10) / 20));
  const hints: string[] = [];
  return { score: clamp10(trimFrac * 7 + (1 - wallPenalty) * 3), hints };
}

function buildings(state: GridState): QualityDimension {
  const all = getPlaceableByRole('home');
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
    if (n < target / 4) hints.push(`${names[i]} quadrant is barely decorated (${n} flora/trees) -- plant it in beds, rows or an orchard lattice.`);
  });
  // Noise costs the grade: what the sweep names as speckle is disorder, not decoration.
  const { findings } = speckleFindings(state);
  for (const f of findings.slice(0, 3)) hints.push(`Noisy planting at ${f.rect} (${f.why}) -- clear it or replant as one bed.`);
  // Homes packed wall to wall read as one stamped block: the reference spaces each home with its
  // own composed yard. Counted as buildings standing within a cell of another building.
  const homes = [...state.objects.values()].filter((o) => !o.locked && roleOf(o) === 'home').map((o) => objectRect(o));
  const packed = new Set<number>();
  for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) {
    const a = homes[i]!, b = homes[j]!;
    const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
    const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
    if (Math.max(gapX, gapY) <= 1) { packed.add(i); packed.add(j); }
  }
  if (packed.size >= 4) {
    hints.push(`${packed.size} homes stand packed within a cell of each other -- the reference gives every home its own spaced, composed yard; spread them and dress each one.`);
  }
  const noisePenalty = Math.min(4, findings.length) + (packed.size >= 4 ? 1 : 0);
  // A locked set piece (the plaza) keeps a grass apron on every face; roads may touch it at
  // discrete points, but planting or buildings pressed against its wall smother the icon.
  for (const lk of state.objects.values()) {
    if (!lk.locked) continue;
    const r = objectRect(lk);
    let flush = 0;
    for (const o of state.objects.values()) {
      if (o.locked) continue;
      const item = getCatalogItem(o.catalogId);
      if (isCoatingItem(item) || isCrossing(item)) continue;
      const or = objectRect(o);
      const gapX = Math.max(r.x - (or.x + or.w), or.x - (r.x + r.w));
      const gapY = Math.max(r.y - (or.y + or.h), or.y - (r.y + r.h));
      if (Math.max(gapX, gapY) < 1) flush++;
    }
    if (flush > 4) {
      hints.push(`${flush} object(s) sit flush against the locked structure at (${r.x},${r.y}) -- keep a 1-2 cell ${BUILDABLE_ZONES} apron on ALL its faces; pull planting and buildings back.`);
    }
  }
  return { score: clamp10((Math.min(...quad) / Math.max(target / 4, 1)) * 6 + Math.min(total / Math.max(target, 1), 1) * 4 - noisePenalty), hints };
}

function roads(state: GridState): QualityDimension {
  const roadCells = new Set<string>();
  const buildingsArr = [...state.objects.values()].filter(
    (o) => !o.locked && roleOf(o) === 'home',
  );
  for (const o of state.objects.values()) {
    if (isCoatingItem(getCatalogItem(o.catalogId))) roadCells.add(cellKey(o.position.x, o.position.y));
  }
  if (buildingsArr.length === 0) return { score: 0, hints: ['No buildings yet, so no road network to judge.'] };
  let connected = 0;
  for (const b of buildingsArr) {
    const r = objectRect(b);
    let near = false;
    outer: for (let y = Math.floor(r.y) - 6; y <= r.y + r.h + 6 && !near; y++)
      for (let x = Math.floor(r.x) - 6; x <= r.x + r.w + 6; x++)
        if (roadCells.has(cellKey(x, y))) { near = true; break outer; }
    if (near) connected++;
  }
  const frac = connected / buildingsArr.length;
  const hints: string[] = [];
  if (frac < 1) hints.push(`${buildingsArr.length - connected} of ${buildingsArr.length} buildings have no road within 6 cells -- build_road to connect them.`);
  return { score: clamp10(frac * 10), hints };
}

/** The evaluate_map report: every dimension's grade and hints for the current map. */
export function qualityReport(state: GridState): QualityReport {
  const g = readMap(state);
  return {
    connectivity: connectivity(state, g),
    terrainInterest: terrainInterest(g),
    water: water(state, g),
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
  return `MAP QUALITY SCORECARD\n${overallLine}\n${lines.join('\n')}\nWhole-map aesthetic heuristics, not task requirements. Investigate only findings relevant to the requested work; preserve intentional design choices.`;
}
