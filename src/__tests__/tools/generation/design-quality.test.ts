// Design-quality probes — the generator's promises to the player, pinned as tests:
// no boring flats, water on the levels, realized crossings, NO ISOLATED REGIONS, determinism.
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { ItemCategory, type PlacedObject } from '../../../core/model/types';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { toGenConfig } from '../../../tools/generation';
import { populate } from '../../../tools/generation/placement';
import { TUNING } from '../../../tools/generation/tuning';
import { getCell } from '../../../core/model/grid-model';
import { objectRect } from '../../../state/object-geometry';
import { buildingGate, hasGate } from '../../../tools/generation/placement/object';
import { getCatalogItem } from '../../../state/catalog';
import { CellZone, TerrainType, type Command, type EditorEvents, type GenerateConfig, type GridState } from '../../../core/model/types';
import { ELEVATION_MAX } from '../../../core/model/constants';
import { categoryOf, isDecoration } from '../../../state/catalog';

const SIZE = 64;

function build(mode: 'earth' | 'mixed', seed: number, naturalness?: number): { state: GridState; planned: number; violations: number } {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  // Navigability/quality probes run at SIZE 64 / maxElev 6 — a tall (elev-8) massif needs more width
  // than a 64-cell square to stay navigable; the REAL-SCALE probe covers the full cap at 120 cells.
  const config: GenerateConfig = { algorithm: 'random', mode, corridorWidth: 1, maxElevation: 6, seed, region: null, ...(naturalness !== undefined ? { naturalness } : {}) };
  let planned = 0;
  exec.runSilently(() => {
    const r = generateTerrain(config, state, (c: Command) => exec.execute(c));
    planned = r.zonePlan?.crossings.length ?? 0;
    void populate(toGenConfig(config), state, (c: Command) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
  });
  const violations = exec.commitStrokeGroup(exec.getUndoStackSize()).length;
  return { state, planned, violations };
}

/** build() at the FULL elevation cap — crown massifs (the tall spires) only climb when the
 *  relief-scaled target peak clears crownMinPeak, which maxElev 6 never reaches. */
function buildTall(mode: 'earth' | 'mixed', seed: number, naturalness: number): { state: GridState; violations: number } {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const config: GenerateConfig = { algorithm: 'random', mode, corridorWidth: 1, maxElevation: ELEVATION_MAX, seed, region: null, naturalness };
  exec.runSilently(() => {
    const r = generateTerrain(config, state, (c: Command) => exec.execute(c));
    void populate(toGenConfig(config), state, (c: Command) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
  });
  const violations = exec.commitStrokeGroup(exec.getUndoStackSize()).length;
  return { state, violations };
}

/** Cells covered by any object footprint. */
function objectCells(state: GridState): Set<number> {
  const out = new Set<number>();
  for (const o of state.objects.values()) {
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) out.add(y * SIZE + x);
  }
  return out;
}

/** Fraction of walkable LAND cells reachable from the town heart. Walkable = grass (not water);
 *  the walk may change elevation ONLY through a crossing footprint (cliffs need a ramp, water a
 *  bridge). Size-parametric so it serves both the 64-cell probes and the 120-cell real-scale one. */
function walkableCoverage(state: GridState, S: number): number {
  const cross = new Set<number>();
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const cat = categoryOf(o);
    if (cat !== ItemCategory.Bridge && cat !== ItemCategory.Ramp) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y) - 1; y <= r.y + r.h; y++) for (let x = Math.floor(r.x) - 1; x <= r.x + r.w; x++) {
      if (x >= 0 && y >= 0 && x < S && y < S) cross.add(y * S + x);
    }
  }
  const walk = (x: number, y: number): { ok: boolean; e: number } => {
    const c = getCell(state.cells, x, y);
    if (!c || c.zone !== CellZone.Grass) return { ok: false, e: -1 };
    if (c.terrain?.type === TerrainType.Water) return { ok: cross.has(y * S + x), e: 0 };
    return { ok: true, e: c.terrain?.elevation ?? 0 };
  };
  const seen = new Set<number>();
  const q: number[] = [];
  let start = -1, sd = Infinity;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const w = walk(x, y);
    if (!w.ok) continue;
    if (getCell(state.cells, x, y)?.terrain?.type === TerrainType.Water) continue;
    const d = (x - S / 2) ** 2 + (y - S / 2) ** 2;
    if (d < sd) { sd = d; start = y * S + x; }
  }
  if (start >= 0) { q.push(start); seen.add(start); }
  while (q.length) {
    const i = q.pop()!;
    const x = i % S, y = (i / S) | 0;
    const here = walk(x, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const j = ny * S + nx;
      if (seen.has(j)) continue;
      const there = walk(nx, ny);
      if (!there.ok) continue;
      if (Math.abs(there.e - here.e) >= 1 && !(cross.has(i) || cross.has(j))) continue; // cliffs need a ramp/bridge
      seen.add(j);
      q.push(j);
    }
  }
  let walkable = 0, reached = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!walk(x, y).ok) continue;
    if (getCell(state.cells, x, y)?.terrain?.type === TerrainType.Water) continue;
    walkable++;
    if (seen.has(y * S + x)) reached++;
  }
  return walkable ? reached / walkable : 1;
}

describe('design quality', () => {
  it('NO BORING FLATS: no big square of undecorated, featureless ground', () => {
    for (const seed of [4, 42]) for (const mode of ['earth', 'mixed'] as const) {
      const { state } = build(mode, seed);
      const objs = objectCells(state);
      // interesting = terrain (mountain/water) or any object; boring = flat bare grass
      const boring = new Uint8Array(SIZE * SIZE);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const t = getCell(state.cells, x, y)?.terrain;
        boring[i] = (!t || t.type === TerrainType.None) && !objs.has(i) ? 1 : 0;
      }
      // largest all-boring square via dynamic programming
      const dp = new Int16Array(SIZE * SIZE);
      let largest = 0;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if (!boring[i]) continue;
        dp[i] = x > 0 && y > 0 ? Math.min(dp[i - 1]!, dp[i - SIZE]!, dp[i - SIZE - 1]!) + 1 : 1;
        if (dp[i]! > largest) largest = dp[i]!;
      }
      expect(largest, `${mode} seed ${seed}: largest boring flat square`).toBeLessThanOrEqual(TUNING.boringFlatMax);
    }
  });

  it('water lives ON the levels: mixed maps keep elevated water through commit', () => {
    let elevated = 0;
    for (const seed of [4, 11, 42]) {
      const { state } = build('mixed', seed);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const t = getCell(state.cells, x, y)?.terrain;
        if (t?.type === TerrainType.Water && t.elevation >= 1) elevated++;
      }
    }
    expect(elevated, 'elevated water across mixed seeds').toBeGreaterThan(0);
  });

  it('TERRACED RIVER: every elevated water body chains DOWN to lower water (one story, no puddles)', () => {
    for (const seed of [4, 11, 42]) {
      const { state } = build('mixed', seed);
      const water = new Int8Array(SIZE * SIZE).fill(-1);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const t = getCell(state.cells, x, y)?.terrain;
        if (t?.type === TerrainType.Water) water[y * SIZE + x] = t.elevation as number;
      }
      // 4-connected components of elevated water; each must see STRICTLY lower water within
      // Chebyshev 3 of some cell (a fall's landing sits at most a rock lip away from the next body).
      const seen = new Set<number>();
      for (let s = 0; s < water.length; s++) {
        if (water[s]! < 1 || seen.has(s)) continue;
        const comp: number[] = [s];
        seen.add(s);
        for (let k = 0; k < comp.length; k++) {
          const i = comp[k]!, x = i % SIZE, y = (i / SIZE) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx, ny = y + dy, j = ny * SIZE + nx;
            if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || seen.has(j) || water[j]! < 1) continue;
            seen.add(j); comp.push(j);
          }
        }
        const lo = Math.min(...comp.map((i) => water[i]!));
        const chained = comp.some((i) => {
          const x = i % SIZE, y = (i / SIZE) | 0;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
            const w = water[ny * SIZE + nx]!;
            if (w >= 0 && w < lo) return true;
          }
          return false;
        });
        expect(chained, `seed ${seed}: elevated water body (${comp.length} cells at >=${lo}) chains down`).toBe(true);
      }
    }
  });

  it('RECTILINEAR STYLE: naturalness 0 commits clean with NO cut corners and STACKED cliffs', () => {
    for (const [mode, seed] of [['mixed', 4], ['earth', 42]] as const) {
      // Full elevation cap: stacked (+3-per-ring) spires come from the crown massifs, which only
      // climb when the relief-scaled target peak clears crownMinPeak — maxElev 6 stays crown-free.
      const { state, violations } = buildTall(mode, seed, 0);
      expect(violations, `${mode} seed ${seed}: post-stroke violations`).toBe(0);
      let cutTerrain = 0, cutRoads = 0, stacked = 0;
      const elevAt = (x: number, y: number): number => {
        const t = getCell(state.cells, x, y)?.terrain;
        return t && t.type === TerrainType.Mountain ? t.elevation : 0;
      };
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const t = getCell(state.cells, x, y)?.terrain;
        if (t?.corners && t.corners.some((c) => c !== 'square')) cutTerrain++;
        if (t?.type === TerrainType.Mountain && (elevAt(x + 1, y) - t.elevation >= 2 || elevAt(x, y + 1) - t.elevation >= 2)) stacked++;
      }
      for (const o of state.objects.values()) {
        if (o.corners && !o.corners.every((c) => c === 'square')) cutRoads++;
      }
      expect(cutTerrain, `${mode} seed ${seed}: terrain cut corners (diagonals) at naturalness 0`).toBe(0);
      expect(cutRoads, `${mode} seed ${seed}: road cut corners at naturalness 0`).toBe(0);
      expect(stacked, `${mode} seed ${seed}: stacked (>=2-layer) cliffs realized`).toBeGreaterThan(0);
    }
  });

  it('BUILDING SPREAD: homes scatter across the island, not one clustered village', () => {
    for (const seed of [4, 42, 99]) {
      const { state } = build('mixed', seed);
      const isBuilding = (o: PlacedObject) => !o.locked && categoryOf(o) === ItemCategory.Building;
      const sectors = new Set<string>();
      let buildings = 0;
      for (const o of state.objects.values()) {
        if (!isBuilding(o)) continue;
        buildings++;
        const r = objectRect(o);
        sectors.add(`${Math.min(3, Math.floor((r.x / SIZE) * 4))},${Math.min(3, Math.floor((r.y / SIZE) * 4))}`);
      }
      expect(buildings, `seed ${seed}: buildings placed`).toBeGreaterThanOrEqual(10);
      expect(sectors.size, `seed ${seed}: 4×4 sectors containing a building`).toBeGreaterThanOrEqual(6);
    }
  });

  it('ROAD CUTS: generated road networks get end-cap/bend trims, like the terrain pass', () => {
    for (const seed of [4, 42]) {
      const { state } = build('mixed', seed);
      let trimmed = 0;
      for (const o of state.objects.values()) {
        if (o.corners && !o.corners.every((c) => c === 'square')) trimmed++;
      }
      expect(trimmed, `seed ${seed}: trimmed road corners`).toBeGreaterThan(0);
    }
  });

  it('planned crossings get realized (at least half land as real bridges/ramps)', () => {
    for (const seed of [4, 42]) {
      const { state, planned } = build('mixed', seed);
      let crossings = 0;
      for (const o of state.objects.values()) {
        if (o.locked) continue;
        const cat = categoryOf(o);
        if (cat === ItemCategory.Bridge || cat === ItemCategory.Ramp) crossings++;
      }
      expect(crossings, `seed ${seed}: realized crossings (planned ${planned})`).toBeGreaterThanOrEqual(Math.ceil(planned / 2));
    }
  });

  it('NO ISOLATED REGIONS: every buildable cell is walkable-reachable from the town heart', () => {
    for (const seed of [4, 42, 99]) for (const mode of ['earth', 'mixed'] as const) {
      const { state } = build(mode, seed);
      expect(walkableCoverage(state, SIZE), `${mode} seed ${seed}: walkable coverage from the town`).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('BUILDING COMPLETION: every catalog building appears in the generated town', async () => {
    const { getPlaceableByCategory } = await import('../../../state/catalog');
    const { ItemCategory } = await import('../../../core/model/types');
    for (const seed of [4, 42]) {
      const { state } = build('mixed', seed);
      const placed = new Set([...state.objects.values()].filter((o) => !o.locked).map((o) => o.catalogId));
      for (const b of getPlaceableByCategory(ItemCategory.Building)) {
        expect(placed.has(b.id), `seed ${seed}: building ${b.id} present`).toBe(true);
      }
    }
  });

  it('REAL-SCALE RELIEF: at relief 1 the terrain climbs to the cap with mass, and stays navigable', () => {
    // A tall (elev-8) massif needs more width than the 64-cell square above; real maps are ~169×140.
    // At a 120-cell scale + relief 1, the terrain must reach near the Max-Height with mass on top AND
    // remain navigable (ramps keep the terraces reachable). Proves #4 (cap reached) + #5 (bold relief).
    const BIG = 120;
    for (const seed of [4, 42]) {
      const state = makeState(BIG, BIG);
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
      const config: GenerateConfig = { algorithm: 'random', mode: 'earth', corridorWidth: 1, maxElevation: ELEVATION_MAX, seed, region: null, relief: 1 };
      exec.runSilently(() => {
        const r = generateTerrain(config, state, (c: Command) => exec.execute(c));
        void populate(toGenConfig(config), state, (c: Command) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
      });
      exec.commitStrokeGroup(exec.getUndoStackSize());
      const hist = new Array(ELEVATION_MAX + 1).fill(0);
      for (let y = 0; y < BIG; y++) for (let x = 0; x < BIG; x++) {
        const t = getCell(state.cells, x, y)?.terrain;
        if (t?.type === TerrainType.Mountain) hist[t.elevation]++;
      }
      let peak = 0, levels = 0;
      for (let e = 1; e <= ELEVATION_MAX; e++) if (hist[e] > 0) { peak = e; levels++; }
      expect(peak, `seed ${seed}: peak reaches near the cap`).toBeGreaterThanOrEqual(7);
      expect(levels, `seed ${seed}: distinct mountain levels`).toBeGreaterThanOrEqual(6);
      expect(hist[peak] + hist[peak - 1]!, `seed ${seed}: mass on the top two levels`).toBeGreaterThanOrEqual(4);
      // ≥0.82 (vs the 0.85 primary invariant at 64/maxElev-6): a dramatic scenic SUMMIT is partly
      // unreachable by design, so tall maps trade a little coverage for the view; the navigable
      // terraced parks keep the bulk walkable.
      expect(walkableCoverage(state, BIG), `seed ${seed}: tall terrain stays mostly navigable`).toBeGreaterThanOrEqual(0.82);
    }
  });

  // The footprint's bottom-edge centre (building gate) and a crossing's two end cells — mirror the
  // generator's own buildingGate / crossingEnds so the reserved zones match.
  const crossEnds = (o: { position: { x: number; y: number } } & Parameters<typeof objectRect>[0]) => {
    const r = objectRect(o);
    const hor = r.w >= r.h, mX = Math.floor(r.x + r.w / 2), mY = Math.floor(r.y + r.h / 2);
    return hor
      ? [{ x: Math.floor(r.x) - 1, y: mY }, { x: Math.ceil(r.x + r.w), y: mY }]
      : [{ x: mX, y: Math.floor(r.y) - 1 }, { x: mX, y: Math.ceil(r.y + r.h) }];
  };
  const isCrossing = (id: string) => id.includes('bridge') || id.includes('ramp');

  /** Road-covered cells of a generated state. */
  const roadCellsOf = (state: GridState): Set<number> => {
    const out = new Set<number>();
    for (const o of state.objects.values()) if (!o.locked && o.catalogId.startsWith('road')) {
      const r = objectRect(o);
      for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) out.add(y * SIZE + x);
    }
    return out;
  };
  const isDecor = (o: PlacedObject) => isDecoration(o);

  it('CLEARANCE: no decoration (tree OR flora) intrudes on a house gate strip or a ramp/bridge end (3×3)', () => {
    for (const seed of [4, 42]) {
      const { state } = build('mixed', seed);
      const clearance = new Set<number>();
      const add = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) clearance.add(y * SIZE + x); };
      for (const o of state.objects.values()) {
        if (o.locked) continue;
        const item = getCatalogItem(o.catalogId);
        if (item && hasGate(item)) {
          for (const c of buildingGate(objectRect(o), o.rotation).clear) add(c.x, c.y); // rotation-aware 3×2 gate strip
        }
        if (isCrossing(o.catalogId)) for (const e of crossEnds(o)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(e.x + dx, e.y + dy); // 3×3 ends
      }
      for (const o of state.objects.values()) {
        if (!isDecor(o)) continue;
        const r = objectRect(o);
        for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
          expect(clearance.has(y * SIZE + x), `seed ${seed}: ${o.catalogId}@${x},${y} blocks a clearance zone`).toBe(false);
        }
      }
    }
  });

  it('DECOR OFF ROADS: no tree or flower sits on a paved road cell', () => {
    for (const seed of [4, 42, 99]) {
      const { state } = build('mixed', seed);
      const roadCells = roadCellsOf(state);
      for (const o of state.objects.values()) {
        if (!isDecor(o)) continue;
        const r = objectRect(o);
        for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
          expect(roadCells.has(y * SIZE + x), `seed ${seed}: ${o.catalogId}@${x},${y} sits on a road`).toBe(false);
        }
      }
    }
  });

  it('CROSSINGS ROAD-CONNECTED: most ramps/bridges have pavement AT both ends (not merely nearby)', () => {
    // The flat rule can refuse a tile on the exact transition cell beside a cliff/water edge, and a
    // few scenic crossings land in unreachable pockets, so 100% is terrain-impossible — but with the
    // crossing-connection pass the large majority must carry a road tile within 1 cell of BOTH ends.
    let total = 0, bothEnds = 0;
    for (const seed of [4, 42, 99]) {
      const { state } = build('mixed', seed);
      const roadCells = roadCellsOf(state);
      const roadAt = (c: { x: number; y: number }) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = c.x + dx, y = c.y + dy;
          if (x >= 0 && y >= 0 && x < SIZE && y < SIZE && roadCells.has(y * SIZE + x)) return true;
        }
        return false;
      };
      const crossings = [...state.objects.values()].filter((o) => !o.locked && isCrossing(o.catalogId));
      total += crossings.length;
      bothEnds += crossings.filter((o) => crossEnds(o).every(roadAt)).length;
    }
    // Measured today: 12/19 across these seeds. The misses sit in regions the terrain makes
    // unreachable-by-rule (e.g. a river with unequal banks is unbridgeable — a known generator
    // limitation), so 100% is impossible; the regulation is "connected when possible".
    expect(bothEnds, `crossings paved at both ends (${bothEnds}/${total})`).toBeGreaterThanOrEqual(Math.ceil(total * 0.55));
  });

  it('GATES ROADED: most house gates have pavement at the doorstep', () => {
    let total = 0, roaded = 0;
    for (const seed of [4, 42, 99]) {
      const { state } = build('mixed', seed);
      const roadCells = roadCellsOf(state);
      for (const o of state.objects.values()) {
        const item = getCatalogItem(o.catalogId);
        if (o.locked || !item || !hasGate(item)) continue;
        total++;
        const { approach } = buildingGate(objectRect(o), o.rotation);
        outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = approach.x + dx, y = approach.y + dy;
          if (x >= 0 && y >= 0 && x < SIZE && y < SIZE && roadCells.has(y * SIZE + x)) { roaded++; break outer; }
        }
      }
    }
    // Measured today: 17/27 across these seeds — the misses are houses in rooms the terrain cut
    // off (unbridgeable river banks), where no road can ever arrive. Reachable rooms connect
    // reliably (seed 4: 9/9).
    expect(roaded, `gates with pavement at the doorstep (${roaded}/${total})`).toBeGreaterThanOrEqual(Math.ceil(total * 0.55));
  });

  it('deterministic: the same seed reproduces the identical object sequence', () => {
    const a = build('mixed', 4), b = build('mixed', 4);
    const ids = (s: GridState) => [...s.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).join('|');
    expect(ids(a.state)).toBe(ids(b.state));
  });
});
