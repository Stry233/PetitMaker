/**
 * A pure fold over GridState into the facts a prompt can describe: water bodies, bridges, road
 * coverage, building/planting clusters, terracing and islet shape. No DOM, no store —
 * `verbalize.ts` turns this into English clauses.
 */
import { TerrainType, type CatalogItem, type GridState } from '../../../core/model/types';
import { OFF_MAP_ZONE, isOpenSeaZone } from '../../../core/game/zones';
import { isBridge, isCoatingItem } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { stylizeElementOf } from './element';
import { componentCells, labelComponents } from '../../../core/grid/cell-sets';

export type Quadrant =
  | 'northwest' | 'north' | 'northeast'
  | 'west' | 'center' | 'east'
  | 'southwest' | 'south' | 'southeast';

export interface WaterBody { kind: 'river' | 'lake' | 'pond'; cells: number; at: Quadrant; runs?: 'north-south' | 'east-west' }
export interface Cluster { kind: 'building' | 'plant'; count: number; at: Quadrant }
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
  const water = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (state.cells[y]?.[x]?.terrain?.type === TerrainType.Water) water[y * width + x] = 1;
  }
  const { labels, sizes } = labelComponents(water, width, height);
  const bodies: WaterBody[] = [];
  for (const cells of componentCells(labels, sizes.length - 1)) {
    const count = cells.length;
    let minX = width, maxX = 0, minY = height, maxY = 0, sumX = 0, sumY = 0;
    for (const i of cells) {
      const x = i % width, y = (i - x) / width;
      sumX += x; sumY += y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
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

  return bodies.sort((a, b) => b.cells - a.cells).slice(0, 3);
}

/** The cluster an object's stylize element buckets it into: buildings and planting; the rest has
 *  no bearing on scene clustering. */
function clusterBucket(element: ReturnType<typeof stylizeElementOf>): Cluster['kind'] | null {
  return element === 'building' || element === 'plant' ? element : null;
}

function findClusters(state: GridState): Cluster[] {
  const { width, height } = state.template;
  const byKind = new Map<Cluster['kind'], Map<Quadrant, number>>();

  for (const obj of state.objects.values()) {
    const bucket = clusterBucket(stylizeElementOf(getCatalogItem(obj.catalogId)));
    if (!bucket) continue;
    const at = quadrantOf(obj.position.x, obj.position.y, width, height);
    const byQuadrant = byKind.get(bucket) ?? new Map<Quadrant, number>();
    byQuadrant.set(at, (byQuadrant.get(at) ?? 0) + 1);
    byKind.set(bucket, byQuadrant);
  }

  const clusters: Cluster[] = [];
  for (const [kind, byQuadrant] of byKind) {
    let topAt: Quadrant | null = null, topCount = 0;
    for (const [at, count] of byQuadrant) {
      if (count > topCount) { topCount = count; topAt = at; }
    }
    if (topAt !== null && topCount >= 5) clusters.push({ kind, count: topCount, at: topAt });
  }

  return clusters.sort((a, b) => b.count - a.count).slice(0, 4);
}

function countWhere(state: GridState, keep: (item: CatalogItem | undefined) => boolean): number {
  let n = 0;
  for (const obj of state.objects.values()) if (keep(getCatalogItem(obj.catalogId))) n++;
  return n;
}

function roadCoverage(state: GridState): SceneManifest['roadCoverage'] {
  const n = countWhere(state, isCoatingItem);
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

/** A border ring mostly outside the template's actual land shape (open sea) reads as an
 *  islet sitting in open water, distinct from a rectangular map that simply has no terrain yet. */
function isIslandShaped(state: GridState): boolean {
  const { width, height } = state.template;
  const isVoid = (x: number, y: number) => isOpenSeaZone(state.cells[y]?.[x]?.zone ?? OFF_MAP_ZONE);
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
    bridges: countWhere(state, isBridge),
    roadCoverage: roadCoverage(state),
    clusters: findClusters(state),
    ...terracing(state),
    islandShaped: isIslandShaped(state),
  };
}
