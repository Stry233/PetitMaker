import { realSurface } from '../../../core/domain/terrain/terrain-surface';
import { detectBridgeSpan } from '../../../core/domain/terrain/bridge-span';
import { getCell } from '../../../core/model/grid-model';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { isBuildableZone } from '../../../core/game/zones';
import { TerrainType, type CatalogItem, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { crossingRunsAlongX, objectRect } from '../../../state/object-geometry';
import { rampOrientation } from '../../../core/domain/terrain/ramp-span';
import type { PlacementAnalysis } from '../../placement/analysis';
import { probePlacement, type PlaceCtx } from '../../placement/object';
import { portalAdjacency, type Portal } from './portals';
import { TUNING } from './tuning';
import { crossingPool } from '../../placement/crossings';
import { findTrait, isBridge, isRamp, spanFootprintLength } from '../../../core/model/traits';

type CrossingContext = Pick<PlaceCtx, 'state' | 'registry'>;

function landLevel(ctx: CrossingContext, x: number, y: number): number {
  const cell = getCell(ctx.state.cells, x, y), surface = realSurface(cell?.terrain);
  return !cell || !isBuildableZone(cell.zone) || surface?.type === TerrainType.Water ? -1 : surface?.elevation ?? 0;
}

/** An approach cannot skip a second cliff or a water cell to reach unrelated open ground. */
function approach(ctx: CrossingContext, a: PlacementAnalysis, start: MacroCoord, step: MacroCoord, level: number): MacroCoord | null {
  for (let d = 0; d < TUNING.portalScanReach; d++) {
    const x = start.x + step.x * d, y = start.y + step.y * d;
    if (landLevel(ctx, x, y) !== level) return null;
    if (a.open[y * a.width + x] === 1) return { x, y };
  }
  return null;
}

function approaches(ctx: CrossingContext, a: PlacementAnalysis, item: CatalogItem, obj: PlacedObject): Pick<Portal, 'approachA' | 'approachB' | 'landingA' | 'landingB'> | null {
  const r = objectRect(obj), horizontal = crossingRunsAlongX(obj);
  const drop = findTrait(item, 'heightDrop');
  const { highAtStart } = rampOrientation(obj.rotation);
  const low = obj.elevation - (drop?.layers ?? 0);
  const levelA = highAtStart ? obj.elevation : low, levelB = highAtStart ? low : obj.elevation;
  const cross = horizontal ? r.y : r.x, span = horizontal ? r.h : r.w;
  const center = Math.floor(cross + (span - 1) / 2);
  const lanes = Array.from({ length: Math.ceil(cross + span) - Math.floor(cross) }, (_, i) => Math.floor(cross) + i)
    .sort((x, y) => Math.abs(x - center) - Math.abs(y - center));
  for (const lane of lanes) {
    const landingA = horizontal ? { x: Math.floor(r.x) - 1, y: lane } : { x: lane, y: Math.floor(r.y) - 1 };
    const landingB = horizontal ? { x: Math.ceil(r.x + r.w), y: lane } : { x: lane, y: Math.ceil(r.y + r.h) };
    const A = approach(ctx, a, landingA, horizontal ? { x: -1, y: 0 } : { x: 0, y: -1 }, levelA);
    const B = approach(ctx, a, landingB, horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 }, levelB);
    if (A && B) return { approachA: A, approachB: B, landingA, landingB };
  }
  return null;
}

/** Aimed routes keep legal sites along the whole boundary, including half-grid and narrow decks. */
export function scanRoutePortals(ctx: CrossingContext, a: PlacementAnalysis): { portals: Portal[]; regionAdj: Map<number, Portal[]> } {
  const items = (['bridge', 'ramp'] as const).flatMap(kind => {
    const seen = new Set<string>();
    return crossingPool(kind).filter(item => {
      const geometry = `${item.width},${item.height}|${JSON.stringify(item.traits)}`;
      if (seen.has(geometry)) return false;
      seen.add(geometry); return true;
    });
  });
  const levels = new Int8Array(a.width * a.height);
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) levels[y * a.width + x] = landLevel(ctx, x, y);
  const levelAt = (x: number, y: number): number => x < 0 || y < 0 || x >= a.width || y >= a.height ? -1 : levels[y * a.width + x]!;
  const bridgeReach = Math.max(0, ...items.flatMap(item => item.traits.flatMap(t => t.type === 'waterSpan' ? [spanFootprintLength(t)] : [])));
  // Full half-grid support checks are useful only where higher ground exists on both sides.
  const gap = (x: number, y: number, level: number): boolean => {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      let near = false, far = false;
      for (let d = 1; d <= bridgeReach; d++) {
        near ||= levelAt(x - dx * d, y - dy * d) > level;
        far ||= levelAt(x + dx * d, y + dy * d) > level;
        if (near && far) return true;
      }
    }
    return false;
  };
  const portals: Portal[] = [], tried = new Set<string>(), geometries = new Set<string>(), bridgeSpans = new Set<string>();
  const retain = (item: CatalogItem, anchor: MacroCoord): void => {
    const key = `${item.id}|${anchor.x},${anchor.y}`;
    if (tried.has(key)) return;
    tried.add(key);
    const waterSpan = findTrait(item, 'waterSpan');
    let spanKey = '';
    if (waterSpan) {
      const span = detectBridgeSpan(ctx.state, anchor, item.width, waterSpan.min, waterSpan.max);
      if (!span) return;
      spanKey = `${item.id}|${span.position.x},${span.position.y},${span.spanLength},${span.rotation},${span.elevation}`;
      if (bridgeSpans.has(spanKey)) return;
    }
    const obj = probePlacement(ctx, item.id, anchor.x, anchor.y);
    if (!obj) return;
    if (spanKey) bridgeSpans.add(spanKey);
    const r = objectRect(obj), kind = isBridge(item) ? 'bridge' : 'ramp';
    const geometry = `${kind}|${r.x},${r.y},${r.w},${r.h}|${obj.rotation},${obj.elevation}`;
    if (geometries.has(geometry)) return;
    geometries.add(geometry);
    const ends = approaches(ctx, a, item, obj);
    if (!ends) return;
    const { approachA, approachB } = ends;
    portals.push({ kind, catalogId: item.id, anchor, ...ends,
      regionA: a.region[approachA.y * a.width + approachA.x]!, regionB: a.region[approachB.y * a.width + approachB.x]!,
      cost: kind === 'bridge' ? TUNING.portalBridgeCost : TUNING.portalRampCost });
  };
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const level = levelAt(x, y);
    if (!NEIGHBORS4.some(([dx, dy]) => levelAt(x + dx, y + dy) > level)) continue;
    const bridge = gap(x, y, level);
    for (const item of items) {
      if (!bridge && isBridge(item)) continue;
      if (level < 0 && isRamp(item)) continue;
      for (const [ox, oy] of [[0, 0], [-0.5, 0], [0, -0.5], [-0.5, -0.5]] as const) retain(item, { x: x + ox, y: y + oy });
    }
  }
  return { portals, regionAdj: portalAdjacency(portals) };
}
