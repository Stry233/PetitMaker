/** Paves the forecourt in front of an anchor building's door, on the strip its lot faces. */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { getCatalogItem } from '../../../../state/catalog';
import { getRotatedSize } from '../../../../core/grid/footprint';
import { tryPlace } from '../../../placement/object';
import type { AnchorPlan } from '../places/anchors';
import { ANCHOR_KINDS } from '../themes';
import type { DressInput } from './types';

/** The forecourt an arrival building takes: cells deep into the lot, and its widest span. */
const FORECOURT = { deep: 3, span: 8 } as const;

/** The footprints an anchor region's buildings stand on, for its hedges. */
export function buildingRects(anchors: AnchorPlan, regionId: string): Rect[] {
  const out: Rect[] = [];
  for (const p of anchors.placements) {
    if (p.regionId !== regionId) continue;
    const item = getCatalogItem(p.catalogId);
    if (!item) continue;
    const size = getRotatedSize(item, p.rotation);
    out.push({ x: p.position.x, y: p.position.y, w: size.w, h: size.h });
  }
  return out;
}

/**
 * The forecourt an arrival building takes: a paved apron across the front of the museum's and the
 * shop's lots, the two anchors a visitor walks up to.
 *
 * It is laid only where it meets pavement already down. A detached paved court would be a piece of
 * road network the plaza cannot reach, which is a hard-rule failure rather than an ornament, so the
 * scan would rather lay nothing.
 */
export function layForecourts(input: DressInput, surface: Int8Array): number {
  const { place, plan } = input;
  const W = place.state.template.width, H = place.state.template.height;
  let paved = 0;
  for (const region of plan.regions) {
    if (region.kind === 'theme' || !ANCHOR_KINDS[region.kind].forecourt) continue;
    const lot = region.lot[0];
    if (!lot) continue;
    const rect = frontStrip(lot, region.orientation);
    if (rect.w < 3 || rect.h < 3) continue;
    const cells: { x: number; y: number }[] = [];
    let free = true, touches = false;
    for (let y = rect.y; y < rect.y + rect.h && free; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || surface[flatIndex(x, y, W)] !== 0) { free = false; break; }
        if (input.within && !input.within(x, y)) { free = false; break; }
        if (place.roads.has(flatIndex(x, y, W))) { touches = true; continue; }
        cells.push({ x, y });
      }
    }
    if (!free || !cells.length) continue;
    for (const c of cells) {
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = c.x + dx;
        if (nx >= 0 && nx < W && place.roads.has(flatIndex(nx, c.y + dy, W))) { touches = true; break; }
      }
      if (touches) break;
    }
    if (!touches) continue;
    for (const c of cells) if (tryPlace(place, input.material, c.x, c.y)) paved++;
  }
  return paved;
}

/** The strip across a lot's entry side, centred and inset one cell from the lot's edges. */
function frontStrip(lot: Rect, entry: string): Rect {
  const span = Math.min(FORECOURT.span, (entry === 'north' || entry === 'south' ? lot.w : lot.h) - 2);
  const deep = FORECOURT.deep;
  switch (entry) {
    case 'north':
      return { x: lot.x + Math.floor((lot.w - span) / 2), y: lot.y + 1, w: span, h: deep };
    case 'south':
      return { x: lot.x + Math.floor((lot.w - span) / 2), y: lot.y + lot.h - 1 - deep, w: span, h: deep };
    case 'west':
      return { x: lot.x + 1, y: lot.y + Math.floor((lot.h - span) / 2), w: deep, h: span };
    default:
      return { x: lot.x + lot.w - 1 - deep, y: lot.y + Math.floor((lot.h - span) / 2), w: deep, h: span };
  }
}
