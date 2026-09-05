/**
 * A pure fold over GridState into the facts a prompt can describe: water bodies, bridges, road
 * coverage, building/planting clusters, terracing and island shape. No DOM, no store —
 * `verbalize.ts` turns this into English clauses.
 */
import { CellZone, ItemCategory, TerrainType, type GridState } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';

export type Quadrant =
  | 'northwest' | 'north' | 'northeast'
  | 'west' | 'center' | 'east'
  | 'southwest' | 'south' | 'southeast';

export interface WaterBody { kind: 'river' | 'lake' | 'pond'; cells: number; at: Quadrant; runs?: 'north-south' | 'east-west' }
export interface Cluster { category: string; count: number; at: Quadrant }
export interface SceneManifest {
  water: WaterBody[];
  bridges: number;
  roadCoverage: 'none' | 'sparse' | 'connected network';
  clusters: Cluster[];
  terraces: number;
  peakAt: Quadrant | null;
  islandShaped: boolean;
}

const QUADRANT_ROWS: readonly (readonly Quadrant[])[] = [
  ['northwest', 'north', 'northeast'],
  ['west', 'center', 'east'],
  ['southwest', 'south', 'southeast'],
];

/** Which cell of a 3x3 division of the template a point falls in. */
function quadrantOf(x: number, y: number, width: number, height: number): Quadrant {
  const col = Math.min(2, Math.max(0, Math.floor((x / width) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((y / height) * 3)));
  return QUADRANT_ROWS[row]![col]!;
}

function findWaterBodies(state: GridState): WaterBody[] {
  const { width, height } = state.template;
  const visited = new Set<number>();
  const bodies: WaterBody[] = [];
  const key = (x: number, y: number) => y * width + x;
  const isWater = (x: number, y: number) => state.cells[y]?.[x]?.terrain?.type === TerrainType.Water;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited.has(key(x, y)) || !isWater(x, y)) continue;

      const stack: Array<{ x: number; y: number }> = [{ x, y }];
      visited.add(key(x, y));
      let count = 0, minX = x, maxX = x, minY = y, maxY = y, sumX = 0, sumY = 0;
      while (stack.length > 0) {
        const c = stack.pop()!;
        count++; sumX += c.x; sumY += c.y;
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
        const neighbors = [
          { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y },
          { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 },
        ];
        for (const n of neighbors) {
          if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
          if (visited.has(key(n.x, n.y)) || !isWater(n.x, n.y)) continue;
          visited.add(key(n.x, n.y));
          stack.push(n);
        }
      }

      const bboxW = maxX - minX + 1, bboxH = maxY - minY + 1;
      const touchesOpposite = (minX === 0 && maxX === width - 1) || (minY === 0 && maxY === height - 1);
      const aspect = Math.max(bboxW / bboxH, bboxH / bboxW);
      const at = quadrantOf(sumX / count, sumY / count, width, height);

      if (touchesOpposite || aspect > 3) {
        bodies.push({ kind: 'river', cells: count, at, runs: bboxH > bboxW ? 'north-south' : 'east-west' });
      } else if (count >= 80) {
        bodies.push({ kind: 'lake', cells: count, at });
      } else {
        bodies.push({ kind: 'pond', cells: count, at });
      }
    }
  }

  return bodies.sort((a, b) => b.cells - a.cells).slice(0, 3);
}

/** The pseudo-category this module buckets an object's real ItemCategory into: 'plant' merges
 *  tree and flora (a scene reads "planting", not "trees vs flowers"). Categories with no bearing
 *  on scene clustering (road, bridge, ramp, facility) answer null. */
function clusterBucket(category: ItemCategory | undefined): 'building' | 'plant' | null {
  if (category === ItemCategory.Building) return 'building';
  if (category === ItemCategory.Tree || category === ItemCategory.Flora) return 'plant';
  return null;
}

function findClusters(state: GridState): Cluster[] {
  const { width, height } = state.template;
  const byCategory = new Map<'building' | 'plant', Map<Quadrant, number>>();

  for (const obj of state.objects.values()) {
    const bucket = clusterBucket(categoryOf(obj));
    if (!bucket) continue;
    const at = quadrantOf(obj.position.x, obj.position.y, width, height);
    const byQuadrant = byCategory.get(bucket) ?? new Map<Quadrant, number>();
    byQuadrant.set(at, (byQuadrant.get(at) ?? 0) + 1);
    byCategory.set(bucket, byQuadrant);
  }

  const clusters: Cluster[] = [];
  for (const [category, byQuadrant] of byCategory) {
    let topAt: Quadrant | null = null, topCount = 0;
    for (const [at, count] of byQuadrant) {
      if (count > topCount) { topCount = count; topAt = at; }
    }
    if (topAt !== null && topCount >= 5) clusters.push({ category, count: topCount, at: topAt });
  }

  return clusters.sort((a, b) => b.count - a.count).slice(0, 4);
}

function countByCategory(state: GridState, category: ItemCategory): number {
  let n = 0;
  for (const obj of state.objects.values()) if (categoryOf(obj) === category) n++;
  return n;
}

function roadCoverage(state: GridState): SceneManifest['roadCoverage'] {
  const n = countByCategory(state, ItemCategory.Road);
  if (n < 20) return 'none';
  if (n < 200) return 'sparse';
  return 'connected network';
}

function terracing(state: GridState): { terraces: number; peakAt: Quadrant | null } {
  const { width, height } = state.template;
  let maxElevation = 0, sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elevation = state.cells[y]?.[x]?.terrain?.elevation ?? 0;
      if (elevation > maxElevation) { maxElevation = elevation; sumX = x; sumY = y; count = 1; }
      else if (elevation === maxElevation && maxElevation > 0) { sumX += x; sumY += y; count++; }
    }
  }
  if (maxElevation === 0) return { terraces: 0, peakAt: null };
  return { terraces: maxElevation, peakAt: quadrantOf(sumX / count, sumY / count, width, height) };
}

/** A border ring mostly outside the template's actual island shape (CellZone.Void) reads as an
 *  island sitting in open water, distinct from a rectangular map that simply has no terrain yet. */
function isIslandShaped(state: GridState): boolean {
  const { width, height } = state.template;
  const isVoid = (x: number, y: number) => (state.cells[y]?.[x]?.zone ?? CellZone.Void) === CellZone.Void;
  let border = 0, empty = 0;
  for (let x = 0; x < width; x++) {
    border++; if (isVoid(x, 0)) empty++;
    border++; if (isVoid(x, height - 1)) empty++;
  }
  for (let y = 1; y < height - 1; y++) {
    border++; if (isVoid(0, y)) empty++;
    border++; if (isVoid(width - 1, y)) empty++;
  }
  return border > 0 && empty / border > 0.6;
}

export function buildManifest(state: GridState): SceneManifest {
  return {
    water: findWaterBodies(state),
    bridges: countByCategory(state, ItemCategory.Bridge),
    roadCoverage: roadCoverage(state),
    clusters: findClusters(state),
    ...terracing(state),
    islandShaped: isIslandShaped(state),
  };
}
