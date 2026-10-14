/**
 * Composes the planted runs: the spot a street's end arrives at, mirrored in a formally composed
 * run, and the marks one run's palette lays.
 */
import { flatIndex } from '../../../../core/grid/rect';
import type { PlacedObject } from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import type { AnchorPlan } from '../places/anchors';
import type { RegionPalette } from './palette';
import { mirrorOf, reflect, symmetrize, type Axis, type Mirror } from './symmetry';
import type { DesignPlan, RegionPlan } from '../types';
import { hedgeMarks } from './anchor';
import { compose } from './elements';
import { ARRIVAL_DECOR } from '../streets/settle';
import type { DressInput, KitCanvas, KitStyle, PlantMark } from './types';
import { streetTermini } from '../../../reading/street-ends';
import { bankMarks } from './banks';
import { buildingRects } from './forecourts';
import { nearestRegion } from './ground';

/** How far ahead of a street's end its composed spot is planted, and how many marks it takes. A
 *  street end arrives at a composed place when `streets/settle.ts:ARRIVAL_DECOR` planted cells stand
 *  within `ARRIVAL_REACH` of its face, so the spot stays inside that window with a mark to spare. */
const END_REACH = 3;
const END_MARKS = ARRIVAL_DECOR + 1;

/** A formally composed run: its cells and the mirror its composition is drawn about. */
export interface FormalRun { cells: ReadonlySet<number>; mirror: Mirror }

/**
 * The composed spot at the end of a path.
 *
 * `streetTermini` reads the finished pavement for the ends a street stops at; each one takes a short
 * block of one species on the open ground straight ahead of it, drawn from the palette of the region
 * whose lot is nearest. It is the smallest composition the kits make and it is the one the arrival
 * reading is looking for: a walk that ends somewhere rather than in grass. Each group is one mark,
 * or a mark and its mirror image where the mark stands in a formally composed run.
 */
export interface EndGround {
  surface: Int8Array;
  open: Uint8Array;
  W: number;
  plan: DesignPlan;
  palettes: ReadonlyMap<string, RegionPalette>;
  /** The region owning each run cell, and the palette group it plants from. */
  ownerOf: ReadonlyMap<number, string>;
  paletteOf: ReadonlyMap<number, string>;
  formalRuns: ReadonlyMap<number, FormalRun>;
}

export function endMarks(input: DressInput, ground: EndGround): PlantMark[][] {
  const { surface, open, W, plan, palettes, ownerOf, paletteOf, formalRuns } = ground;
  const out: PlantMark[][] = [];
  const done = new Set<number>();
  for (const end of streetTermini(input.place.state)) {
    const aheadCell = end.face
      .map((c) => flatIndex(c.x + end.dx, c.y + end.dy, W))
      .find((i) => ownerOf.has(i));
    const ahead = aheadCell === undefined ? undefined : ownerOf.get(aheadCell);
    // Where the ground ahead belongs to no run — too small to compose on, which is exactly where a
    // walk ends at nothing — the nearest region's palette stands in.
    const regionId = ahead
      ?? nearestRegion(plan, end.face.map((c) => flatIndex(c.x, c.y, W)), W);
    const palette = palettes.get((aheadCell === undefined ? undefined : paletteOf.get(aheadCell)) ?? regionId);
    if (!palette) continue;
    const id = palette.species('mass');
    if (getCatalogItem(id)?.traits?.some((t) => t.type === 'exclusionRadius')) continue;
    // Centre of the face outward, so the block comes out mirrored about the street's own axis: an
    // end spot laid greedily from one side is an asymmetry dropped into a region the composition
    // score reads as a whole.
    // The spot is laid where a walker coming down the street sees it: within a cell of the street's
    // own centreline, which is the window the arrival reading counts a composed place in. Spread
    // across the whole face, most of its marks fall outside that window and the street still ends at
    // nothing as far as the reading is concerned.
    const mid = (end.face.length - 1) / 2;
    const face = [...end.face.entries()]
      .filter(([k]) => Math.abs(k - mid) <= 1)
      .sort((a, b) => Math.abs(a[0] - mid) - Math.abs(b[0] - mid) || a[0] - b[0])
      .map(([, c]) => c);
    let laid = 0;
    for (let k = 1; k <= END_REACH && laid < END_MARKS; k++) {
      for (const c of face) {
        if (laid >= END_MARKS) break;
        const x = c.x + end.dx * k, y = c.y + end.dy * k;
        const i = flatIndex(x, y, W);
        if (!open[i] || surface[i]! < 0 || done.has(i)) continue;
        // Into a mirrored place in pairs. A spot at a street's end stands on the region's edge rather
        // than inside its composition, so in a formally composed run each mark is laid with its
        // mirror image, or not at all where that image's cell cannot carry it. An image falling
        // outside the run has no cell to answer it, and the mark stands alone.
        const run = formalRuns.get(i);
        const twin = run ? reflect(run.mirror, x, y) : null;
        const j = twin && twin.x >= 0 && twin.x < W && twin.y >= 0 ? flatIndex(twin.x, twin.y, W) : -1;
        const inRun = run !== undefined && j >= 0 && run.cells.has(j);
        if (inRun && (!open[j] || surface[j]! < 0 || done.has(j))) continue;
        done.add(i);
        const group: PlantMark[] = [{ x, y, catalogId: id }];
        if (inRun && j !== i) { done.add(j); group.push({ x: twin!.x, y: twin!.y, catalogId: id }); }
        out.push(group);
        laid++;
      }
    }
  }
  return out;
}

/** A mark as the placed object a load ledger prices. */
export function markObject(mark: PlantMark): PlacedObject {
  return { id: '', catalogId: mark.catalogId, position: { x: mark.x, y: mark.y }, rotation: 0, elevation: 0 };
}

/** The marks in planting order, each with its mirror image of the same species when the run is
 *  formal, so the budget keeps or drops a pair together. */
export function markGroups(marks: readonly PlantMark[], mirror: ReturnType<typeof mirrorOf> | null, W: number): PlantMark[][] {
  if (!mirror) return marks.map((m) => [m]);
  const at = new Map(marks.map((m) => [flatIndex(m.x, m.y, W), m] as const));
  const grouped = new Set<PlantMark>();
  const groups: PlantMark[][] = [];
  for (const mark of marks) {
    if (grouped.has(mark)) continue;
    grouped.add(mark);
    const image = reflect(mirror, mark.x, mark.y);
    const twin = image.x >= 0 && image.x < W && image.y >= 0 ? at.get(flatIndex(image.x, image.y, W)) : undefined;
    if (twin && twin !== mark && !grouped.has(twin) && twin.catalogId === mark.catalogId) {
      grouped.add(twin);
      groups.push([mark, twin]);
    } else groups.push([mark]);
  }
  return groups;
}

/** One run composed: its kit's tiling and bank rows, mirrored where the run is a formal one, with
 *  an anchor region's hedges laid round its buildings first. Each footprint is asked for once. */
export function composeRun(
  job: { canvas: KitCanvas; style: KitStyle; region: RegionPlan; formal: boolean; axis: Axis },
  anchors: AnchorPlan, W: number, water?: Uint8Array,
): PlantMark[] {
  const { canvas, region } = job;
  let marks = compose(canvas, job.style, job.formal ? job.axis : null);
  // The bank is part of the composition, so it is laid before the mirror rather than dropped on top
  // of one: a row along the water added afterwards is exactly the asymmetry a composed place is
  // scored for not having.
  if (water) marks = [...bankMarks(canvas, water, W, water.length / W), ...marks];
  if (job.formal) {
    const taken = new Set(marks.map((m) => flatIndex(m.x, m.y, W)));
    marks = symmetrize(marks, mirrorOf(canvas.box, job.axis), (x, y) =>
      canvas.cells.has(flatIndex(x, y, W)) || taken.has(flatIndex(x, y, W)));
  }
  if (region.kind !== 'theme') {
    marks = [...hedgeMarks(canvas, buildingRects(anchors, region.id)), ...marks];
  }
  // One mark per footprint, not per anchor cell. A tree is not always 1x1, and the bank rows are
  // laid alongside the kit's own tiling rather than by it, so two marks can want ground that
  // overlaps without sharing an anchor — which the rules refuse and a composed mirror then reads as
  // a hole.
  const done = new Set<number>();
  return marks.filter((mark) => {
    const item = getCatalogItem(mark.catalogId);
    const w = item?.width ?? 1, h = item?.height ?? 1;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) if (done.has(flatIndex(mark.x + dx, mark.y + dy, W))) return false;
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) done.add(flatIndex(mark.x + dx, mark.y + dy, W));
    }
    return true;
  });
}
