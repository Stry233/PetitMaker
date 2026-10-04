import { NEIGHBORS4_NESW } from '../../../core/model/grid-model';
import type { GridState, PlacedObject, StencilPlan } from '../../../core/model/types';
import { catalogLoadValue, getCatalogItem } from '../../../state/catalog';
import { LoadBudget } from '../../../state/load-budget';
import type { ColorEntry } from './stencil-palette';
import { detectFeatures, FEATURE_MAX } from './stencil-feature';
import { coherentAreas, colourGap } from './stencil-small';
import { stencilStrokePaths } from './stencil-text-grid';

export type StencilMatches = (ColorEntry | null)[];
export interface BudgetedStencil { plan: StencilPlan; matches: StencilMatches; adapted: boolean }
type StrokePath = ReturnType<typeof stencilStrokePaths>[number];

// Bound the unfilled intervals along every retained stroke, including at the minimum budget.
const MAX_SPACING = 4;
const COLOR_EDGE = 24;

function objectAt(plan: StencilPlan, index: number, catalogId: string): PlacedObject {
  return {
    id: '', catalogId, rotation: 0, elevation: 0,
    position: { x: plan.origin.x + index % plan.stencil.width, y: plan.origin.y + Math.floor(index / plan.stencil.width) },
  };
}

function ledgerFor(state: GridState, plan: StencilPlan, matches: StencilMatches): LoadBudget {
  const ledger = new LoadBudget(state);
  matches.forEach((entry, i) => { if (entry) ledger.change(objectAt(plan, i, entry.catalogId), 1); });
  return ledger;
}

/** Endpoints and turns survive every spacing; intervals distribute marks along the whole stroke. */
function samplePaths(paths: readonly StrokePath[], spacing: number): Set<number> {
  const selected = new Set<number>();
  for (const { cells, corners } of paths) {
    for (const i of corners) selected.add(i);
    const segments = Math.max(1, Math.ceil((cells.length - 1) / spacing));
    for (let part = 0; part <= segments; part++) selected.add(cells[Math.round(part * (cells.length - 1) / segments)]!);
  }
  return selected;
}

function outlines(plan: StencilPlan, matches: StencilMatches): { outer: StrokePath[]; inner: StrokePath[]; features: number[] } {
  const { width, height } = plan.stencil;
  const outer = new Uint8Array(matches.length), inner = new Uint8Array(matches.length);
  const ink = Uint8Array.from(matches, entry => entry ? 255 : 0);
  const matchAt = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? matches[y * width + x] : null;
  for (let i = 0; i < matches.length; i++) {
    const entry = matches[i];
    if (!entry) continue;
    const x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const next = matchAt(x + dx, y + dy);
      if (!next) outer[i] = 255;
      else if (plan.read === 'color' && colourGap(entry.rgb, next.rgb) >= COLOR_EDGE) inner[i] = 255;
    }
  }
  if (plan.read === 'shape') return { outer: stencilStrokePaths(outer, width, height), inner: stencilStrokePaths(ink, width, height), features: [] };

  const areas = coherentAreas(plan.stencil, i => !!matches[i], i => matches[i]?.rgb ?? 0);
  const total = areas.reduce((sum, area) => sum + area.cells.length, 0);
  const features: number[] = [];
  for (const area of areas) {
    // Large color fields and compact isolated details each retain a representative in place.
    if (area.cells.length < total / 20) continue;
    const cx = area.cells.reduce((sum, i) => sum + i % width, 0) / area.cells.length;
    const cy = area.cells.reduce((sum, i) => sum + Math.floor(i / width), 0) / area.cells.length;
    let closest = area.cells[0]!, distance = Infinity;
    for (const i of area.cells) {
      const d = (i % width - cx) ** 2 + (Math.floor(i / width) - cy) ** 2;
      if (d < distance) { closest = i; distance = d; }
    }
    features.push(closest);
  }
  if (areas.length) {
    const channel = (shift: number) => Math.round(areas.reduce((sum, area) => sum + ((area.rgb >> shift) & 255) * area.cells.length, 0) / total);
    const background = (channel(16) << 16) | (channel(8) << 8) | channel(0);
    for (const feature of detectFeatures(plan.stencil, i => !!matches[i], [{ rgb: background }], plan.objectPalette ?? []).slice(0, FEATURE_MAX)) {
      features.push(feature.cells[0]!);
    }
  }
  return { outer: stencilStrokePaths(outer, width, height), inner: stencilStrokePaths(inner, width, height), features };
}

/** Stable spatial tie-breaking distributes equal-priority additions across the figure. */
function spatialOrder(index: number, width: number): number {
  const x = index % width, y = Math.floor(index / width);
  let order = 0;
  for (let bit = 0; bit < 10; bit++) {
    order = (order << 1) | ((x >> bit) & 1);
    order = (order << 1) | ((y >> bit) & 1);
  }
  return order;
}

function sparseMatches(state: GridState, plan: StencilPlan, original: StencilMatches): StencilMatches | null {
  const { outer, inner, features } = outlines(plan, original);
  const primaryPaths = plan.read === 'shape' ? inner : outer;
  const selected = samplePaths(primaryPaths, MAX_SPACING);
  for (const i of features) selected.add(i);
  original.forEach((entry, i) => { if (entry && catalogLoadValue(entry.catalogId) === 0) selected.add(i); });
  // Outline turns retain the full extent of thick glyphs while their skeleton carries the strokes.
  if (plan.read === 'shape') for (const path of outer) for (const i of path.corners) selected.add(i);
  const matches = original.map((entry, i) => selected.has(i) ? entry : null);
  if (!matches.some(Boolean)) return null;
  const ledger = ledgerFor(state, plan, matches);
  if (!ledger.fits) return null;
  const add = (indices: Iterable<number>): boolean => {
    const added = [...new Set(indices)].filter(i => original[i] && !selected.has(i));
    for (const i of added) ledger.change(objectAt(plan, i, original[i]!.catalogId), 1);
    if (!ledger.fits) {
      for (const i of added) ledger.change(objectAt(plan, i, original[i]!.catalogId), -1);
      return false;
    }
    for (const i of added) { selected.add(i); matches[i] = original[i]!; }
    return true;
  };

  const refined = [...primaryPaths];
  if (plan.read === 'color') {
    // Every accepted internal boundary has both ends and its turns before extra density is added.
    for (const path of [...inner].sort((a, b) => b.cells.length - a.cells.length || a.cells[0]! - b.cells[0]!)) {
      if (add(samplePaths([path], MAX_SPACING))) refined.push(path);
    }
  } else refined.push(...outer);
  // Stop at the first exhausted region so optional density stays balanced across region borders.
  for (const spacing of [2, 1]) {
    const candidates = [...samplePaths(refined, spacing)].filter(i => !selected.has(i));
    candidates.sort((a, b) => spatialOrder(a, plan.stencil.width) - spatialOrder(b, plan.stencil.width));
    for (const i of candidates) if (!add([i])) return matches;
  }

  // Fill grows outward from the structural paths, with a stable order independent of the budget.
  const { width, height } = plan.stencil;
  const distance = new Int32Array(original.length).fill(-1);
  const queue = [...new Set([...outer, ...inner].flatMap(path => path.cells))];
  for (const i of queue) distance[i] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !original[next] || distance[next]! >= 0) continue;
      distance[next] = distance[i]! + 1; queue.push(next);
    }
  }
  const rest = original.flatMap((entry, i) => entry && !selected.has(i) ? [i] : []);
  rest.sort((a, b) => distance[a]! - distance[b]! || spatialOrder(a, plan.stencil.width) - spatialOrder(b, plan.stencil.width));
  for (const i of rest) if (!add([i])) break;
  return matches;
}

/** Keep coordinates and material choices unchanged; spend scarce load on strokes and contours. */
export function budgetStencil(
  state: GridState,
  plan: StencilPlan,
  match: (plan: StencilPlan) => StencilMatches,
): BudgetedStencil | null {
  const original = match(plan);
  if (ledgerFor(state, plan, original).fits) return { plan, matches: original, adapted: false };
  const matches = sparseMatches(state, plan, original);
  if (!matches) return null;
  const coverage = new Uint8Array(plan.stencil.coverage.length);
  for (let i = 0; i < matches.length; i++) {
    const entry = matches[i];
    if (!entry) continue;
    const item = plan.read === 'shape' ? getCatalogItem(entry.catalogId) : undefined;
    const x = i % plan.stencil.width, y = Math.floor(i / plan.stencil.width);
    for (let dy = 0; dy < Math.max(1, item?.height ?? 1); dy++) {
      for (let dx = 0; dx < Math.max(1, item?.width ?? 1); dx++) coverage[(y + dy) * plan.stencil.width + x + dx] = 255;
    }
  }
  return { plan: { ...plan, stencil: { ...plan.stencil, coverage } }, matches, adapted: true };
}
