/**
 * The crossings a route can place, bridges over water and ramps up a cliff, chosen by their
 * placement traits; the main one of each kind; and the cells where a road meets one.
 */
import type { CatalogItem, MacroCoord, PlacedObject } from '../../core/model/types';
import { findTrait, isBridge, isRamp } from '../../core/model/traits';
import { bySizeDesc } from '../../core/grid/cell-sets';
import { getPlaceableWhere } from '../../state/catalog';
import { crossingRunsAlongX, objectRect } from '../../state/object-geometry';
import { CLEARANCE } from '../../core/game/profile';

export type CrossingKind = 'bridge' | 'ramp';

/** Every offered crossing of `kind`, in authored order. */
export function crossingPool(kind: CrossingKind): CatalogItem[] {
  return getPlaceableWhere(kind === 'bridge' ? isBridge : isRamp);
}

/** The crossing a route tries first: the grandest bridge (largest footprint, authored order among
 *  equals), or the first ramp. */
export function mainCrossingId(kind: CrossingKind): string | undefined {
  const pool = crossingPool(kind);
  return (kind === 'bridge' ? [...pool].sort(bySizeDesc) : pool)[0]?.id;
}

/** The gaps the offered bridges cross, in cells, or null when the catalog offers none. */
export function bridgeSpanRange(): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (const item of crossingPool('bridge')) {
    const span = findTrait(item, 'waterSpan');
    if (!span) continue;
    min = Math.min(min, span.min);
    max = Math.max(max, span.max);
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/** The bridge a site search assumes when none is named: the smallest deck, which fits the most
 *  sites (authored order among equals). */
export function narrowestBridgeId(): string | undefined {
  const pool = crossingPool('bridge');
  return [...pool].sort((a, b) => a.width * a.height - b.width * b.height)[0]?.id;
}

/** The two end cells just outside a crossing's footprint, along its travel axis: where roads attach
 *  and the navigation clearance is reserved. */
export function crossingEnds(obj: PlacedObject): [MacroCoord, MacroCoord] {
  const r = objectRect(obj);
  const horizontal = crossingRunsAlongX(obj);
  const midX = Math.floor(r.x + r.w / 2), midY = Math.floor(r.y + r.h / 2);
  return horizontal
    ? [{ x: Math.floor(r.x) - 1, y: midY }, { x: Math.ceil(r.x + r.w), y: midY }]
    : [{ x: midX, y: Math.floor(r.y) - 1 }, { x: midX, y: Math.ceil(r.y + r.h) }];
}

/** The cells a crossing keeps open around its ends (`CLEARANCE.crossingEndSide` squares), end by
 *  end, row by row; cells off the map included, so the caller bounds them. */
export function crossingEndClearance(obj: PlacedObject): MacroCoord[] {
  const half = (CLEARANCE.crossingEndSide - 1) / 2;
  const out: MacroCoord[] = [];
  for (const e of crossingEnds(obj)) {
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) out.push({ x: e.x + dx, y: e.y + dy });
  }
  return out;
}
