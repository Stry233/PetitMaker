/**
 * Stage 4 of the designer pipeline: the regions filled in. A region is a run of open ground, not a
 * rectangle: whatever the terrain, roads and buildings leave, the unit a planet's places are read
 * over. The pass segments the finished map into runs and gives each to the region whose lot
 * holds most of it, composed with that region's kit. One author per run, since local symmetry and
 * per-region unity are both read over runs.
 *
 * The amount is a budget: the map is planted to the decoration density band the built-in planets share
 * (0.07 to 0.095 per land cell), and each kit's `appetite` only shares it out.
 *
 * Everything is placed through `tryDecorate`, so the rules judge every plant; a kit's ground
 * features (pools, a sunken court, a terrace ring) are declared here and cut earlier by
 * `terrain-sculpt.ts`, since terrain must be down first.
 */
import { makeRng } from '../../../../core/base/rng';
import { flatIndex } from '../../../../core/grid/rect';
import { getCatalogItem, itemRole } from '../../../../state/catalog';
import { tryDecorate } from '../../../placement/object';
import { spacingClash } from '../../../../rules/placement';
import type { GridState } from '../../../../core/model/types';
import { planPalettes } from './palette';
import { composesFormally, mirrorOf, type Axis } from './symmetry';
import { LoadBudget } from '../../../../state/load-budget';
import type { DesignInput, DesignPlan, RegionPlan } from '../types';
import { boxOf, coverCap } from './elements';
import type { DressInput, KitCanvas, KitGround, KitStyle, PlantMark } from './types';
import { styleOf } from './kits';
import { clamp, lerpClamped } from '../../../../core/base/math';
import { fnv1a32 } from '../../../../core/base/hash';
import { landAt } from '../../../reading/masks';
import { plantableSurface } from '../../../reading/surface';
import { waterMask } from './banks';
import { type FormalRun, composeRun, endMarks, markGroups, markObject } from './ends';
import { layForecourts } from './forecourts';
import { assignRuns, groupPalettes, levelGroups, openGround, segmentRuns } from './ground';

// --- tunables ------------------------------------------------------------------------------------

/** Decoration per land cell at richness 0 and 1. The built-in planets plant 0.073 (the terraced
 *  one) and 0.092 (the flat garden town), for a band of 0.07 to 0.095. The aim sits a little inside
 *  that band rather than on its floor: what a run can actually plant is bounded by the ground the
 *  terrain left it, so a map that cannot reach its aim lands under it, and an aim on the floor puts the
 *  seeds that fall short outside the band. The ceiling is 0.088 rather than 0.090 because the eroded
 *  terrace edges cut the planet into more runs, and at 0.090 the densest seed lands at 0.0955, just over
 *  the band's own ceiling. */
const DENSITY = { min: 0.072, max: 0.088 } as const;
/** What share of a composed mark the rules actually accept. The pass reads the ground before it
 *  composes, so the two only differ where a plant's own sweep disagrees with the reading; the budget
 *  is divided by it so the map lands in the band rather than just under it. */
const YIELD = 0.98;
/** The least cover one run gets, whatever the budget says: a run planted below this is not a
 *  composed place at all. The most is `elements.ts:coverCap`. */
const COVER_MIN = 0.08;
/** Share of runs offered a mirror. About two thirds of a planet's decorated regions mirror, so the aim
 *  is that band and not every region, and the share is higher than that band because `FORMAL_FILL`
 *  turns some of the offers down. */
const FORMAL_SHARE = 0.75;
/** How much of its own bounding box a run must fill to be worth mirroring at all. */
const FORMAL_FILL = 0.5;
/**
 * Flowers per tree at richness 0 and 1, and the axis the built-in planets sit at either end of.
 *
 * The flat garden town plants 1 : 6.6 and the terraced one 1 : 1.12, which makes the ratio a style
 * axis rather than a number to average. Richness is that axis: a quiet map is a garden town, a full one
 * is the planet. It runs backwards if the trees share the cover ladder, since one step of a shared
 * ladder trades three quarters of a block's trees for four times its blooms.
 */
const TREE_RATIO = { min: 6.6, max: 1.4 } as const;

// --- what a kit wants of the ground ----------------------------------------------------------------

/** Every region's ground wants. Richness scales the water: a low-richness map is the flat garden
 *  town, which carries a lake and two channels rather than a pool per region. */
export function planKitGround(
  { plan, seed, richness }: Pick<DesignInput, 'seed' | 'richness'> & { plan: DesignPlan },
): KitGround[] {
  const r = richness < 0 ? 0 : richness > 1 ? 1 : richness;
  return plan.regions.map((region) => {
    const style = styleOf(region, makeRng(regionSeed(seed, region.id)));
    const wanted = style.pools ?? 0;
    return {
      regionId: region.id,
      pools: Math.round(wanted * (0.4 + 0.6 * r)),
      sunken: style.sunken === true,
      ring: style.ring === true,
    };
  });
}

// --- dressing the finished map ----------------------------------------------------------------------

export interface DressOutcome {
  planted: number;
  /** Plants the rules turned down. A composed mark stands on ground the pass already read as
   *  plantable, so this counts the cases the reading and the rules disagree on. */
  refused: number;
  /** Marks left out whole because one stood too near a spaced object (`exclusionRadius`). */
  spaced: number;
  /** Marks left out because their region's load budget could not carry them. A mirrored pair is
   *  left out whole, so the budget never breaks a composed mirror in half. */
  overBudget: number;
  /** Forecourt cells paved beside the museum and the shop. */
  paved: number;
  /** Runs of open ground composed, and how many of those were composed as a mirror. */
  composed: number;
  formal: number;
}

/** Whether a mark would stand too near a spaced object already on the map. */
function tooNearSpaced(state: GridState, mark: PlantMark): boolean {
  const item = getCatalogItem(mark.catalogId);
  return !!item && spacingClash(state, item, { x: mark.x, y: mark.y, w: item.width, h: item.height }) !== null;
}

export function dressRegions(input: DressInput): DressOutcome {
  const { place, plan, anchors, seed } = input;
  const state = place.state;
  const W = state.template.width, H = state.template.height;
  const surface = plantableSurface(state);
  const out: DressOutcome = { planted: 0, refused: 0, spaced: 0, overBudget: 0, paved: 0, composed: 0, formal: 0 };
  // The forecourts go down before the ground is read: they are pavement, and pavement is one of the
  // things that decides where a plant may stand.
  out.paved = layForecourts(input, surface);

  const open = openGround(place, surface, input.avoid, input.within);
  const runs = segmentRuns(open, surface, W, H);
  const owners = assignRuns(runs, plan, W);
  const palettes = planPalettes(plan, seed);
  const paletteOf = groupPalettes(owners, levelGroups(place, surface, W, H), plan);
  const byId = new Map(plan.regions.map((r) => [r.id, r] as const));

  // The budget, shared by appetite: `k` is the cover a run of appetite 1 gets, so the whole map lands
  // in the density band whatever the kits happened to be drawn.
  let land = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (landAt(state, x, y)) land++;
  }
  const styles = new Map<string, KitStyle>();
  const styleFor = (region: RegionPlan): KitStyle => {
    const hit = styles.get(region.id);
    if (hit) return hit;
    const made = styleOf(region, makeRng(regionSeed(seed, region.id)));
    styles.set(region.id, made);
    return made;
  };
  let weight = 0;
  for (const owned of owners) {
    const region = byId.get(owned.regionId);
    if (region) weight += owned.cells.length * styleFor(region).appetite;
  }
  const budget = land * lerpClamped(DENSITY.min, DENSITY.max, input.richness) / YIELD;
  const k = weight > 0 ? budget / weight : 0;

  const jobs: { canvas: KitCanvas; style: KitStyle; region: RegionPlan; formal: boolean; axis: Axis }[] = [];
  for (const owned of owners) {
    const region = byId.get(owned.regionId);
    const palette = palettes.get(paletteOf.get(owned.cells[0]!) ?? owned.regionId);
    if (!region || !palette) continue;
    const cells = owned.cells;
    const style = styleFor(region);
    const rng = makeRng((regionSeed(seed, region.id) ^ Math.imul(cells[0]!, 0x27d4eb2d)) >>> 0);
    const canvas: KitCanvas = {
      regionId: region.id,
      cells: new Set(cells),
      box: boxOf(new Set(cells), W),
      elevation: surface[cells[0]!]!,
      W,
      cover: clamp(k * style.appetite, COVER_MIN, coverCap(treeWeight(style))),
      // A kit's own mix sets where the trees start. A tree avenue asks for lattices and a flower
      // field asks for beds, so each region opens at the share of its own mix that is tree blocks
      // and the map-level correction below scales every region from there — which moves the planet's
      // ratio to the axis without flattening one theme into another.
      treeShare: treeWeight(style),
      orientation: region.orientation,
      palette,
      rng,
    };
    jobs.push({
      canvas, style, region,
      // A ragged run is never composed formally. A mirror only stands where both halves can be
      // planted, so on a run that wanders round a terrace most of its pairs fall on ground that is
      // not there — the marks are dropped, the region reads as neither mirrored nor full, and the
      // composition pays for a symmetry it did not get.
      formal: canvas.cells.size >= FORMAL_FILL * canvas.box.w * canvas.box.h
        && composesFormally(rng, FORMAL_SHARE),
      axis: rng.int(2) === 0 ? 'v' : 'h',
    });
  }

  // The budget is spent, then counted, then spent again, and the ratio rides the same correction.
  // What a cover actually plants depends on the elements the blocks were drawn as and on how much of
  // the mirror the ground could carry, so the first pass is an estimate: each later one scales every
  // cover by how far the last overshot or fell short, and every tree share by how far the map's
  // trees-to-flowers landed from the axis. Composing is pure and cheap, and the corrections land
  // both readings on every seed rather than on most of them.
  const wanted = land * lerpClamped(DENSITY.min, DENSITY.max, input.richness) / YIELD;
  const wantTrees = 1 / (1 + lerpClamped(TREE_RATIO.min, TREE_RATIO.max, input.richness));
  const water = waterMask(state);
  let composed = jobs.map((job) => composeRun(job, anchors, W, water));
  // A path ends at something. The street planner cuts back every end it can, but an end that is a
  // block's only frontage has to stay, and such an end is composed at. So the last thing planted on a map is a small group at each street end that has nothing in
  // front of it, in the palette of whichever region owns the ground there.
  // The region that owns the ground, the same answer `assignRuns` gave: an end spot drawn from a
  // neighbour's palette is a species the run it stands in does not otherwise plant, which is the one
  // thing the unity reading is looking for.
  const ownerOf = new Map<number, string>();
  for (const owned of owners) for (const i of owned.cells) ownerOf.set(i, owned.regionId);
  const formalRuns = new Map<number, FormalRun>();
  for (const job of jobs) {
    if (!job.formal) continue;
    const run = { cells: job.canvas.cells, mirror: mirrorOf(job.canvas.box, job.axis) };
    for (const i of job.canvas.cells) formalRuns.set(i, run);
  }
  const ends = endMarks(input, { surface, open, W, plan, palettes, ownerOf, paletteOf, formalRuns });
  const endCount = ends.reduce((n, group) => n + group.length, 0);
  for (let pass = 0; pass < 3; pass++) {
    // The end spots count against the same budget: they are marks on the map, and leaving them out
    // of the correction puts a map over its decoration band by exactly their number.
    const total = composed.reduce((a, marks) => a + marks.length, 0) + endCount;
    if (total === 0) break;
    let trees = 0;
    for (const marks of composed) for (const m of marks) if (isTree(m.catalogId)) trees++;
    const density = wanted / total;
    const ratio = trees > 0 ? wantTrees / (trees / total) : 2;
    if (Math.abs(density - 1) <= 0.05 && Math.abs(ratio - 1) <= 0.08) break;
    for (const job of jobs) {
      job.canvas.treeShare = clamp(job.canvas.treeShare * ratio, 0, 1);
      job.canvas.cover = clamp(job.canvas.cover * density, COVER_MIN, coverCap(job.canvas.treeShare));
    }
    composed = jobs.map((job) => composeRun(job, anchors, W, water));
  }

  // The load budget is planned, not discovered: a group of marks (a mark and its mirror image) is
  // charged to a ledger first and left out whole when its regions cannot carry it, so the rules
  // never refuse a mark for load and a mirror never loses one half.
  const ledger = new LoadBudget(state);
  const plant = (group: readonly PlantMark[]): void => {
    const objects = group.map(markObject);
    for (const o of objects) ledger.change(o, 1);
    if (!ledger.fits) {
      for (const o of objects) ledger.change(o, -1);
      out.overBudget += group.length;
      return;
    }
    // A mark too near a house the build stood is dropped with its mirror image: the spacing between
    // houses and trees is a rule the composition does not draw.
    if (group.some((mark) => tooNearSpaced(place.state, mark))) {
      for (const o of objects) ledger.change(o, -1);
      out.spaced += group.length;
      return;
    }
    for (const [i, mark] of group.entries()) {
      if (tryDecorate(place, mark.catalogId, mark.x, mark.y)) out.planted++;
      else { out.refused++; ledger.change(objects[i]!, -1); }
    }
  };
  const taken = new Set<number>();
  for (const [index, job] of jobs.entries()) {
    out.composed++;
    if (job.formal) out.formal++;
    const marks = composed[index]!;
    for (const mark of marks) taken.add(flatIndex(mark.x, mark.y, W));
    for (const group of markGroups(marks, job.formal ? mirrorOf(job.canvas.box, job.axis) : null, W)) plant(group);
  }
  for (const group of ends) {
    if (group.some((mark) => taken.has(flatIndex(mark.x, mark.y, W)))) continue;
    plant(group);
  }
  return out;
}

// --- small helpers ------------------------------------------------------------------------------------

/** A stable seed per (map seed, region id), so a region's style does not depend on how many regions
 *  were drawn before it. */
function regionSeed(seed: number, regionId: string): number {
  return fnv1a32(regionId, seed ^ 0x4b1d5eed);
}

/** The share of a kit's own draw weight that asks for a tree block. */
function treeWeight(style: KitStyle): number {
  let tree = 0, total = 0;
  for (const [kind, weight] of style.mix) {
    total += weight;
    if (kind === 'orchard' || kind === 'grove') tree += weight;
  }
  return total > 0 ? tree / total : 0;
}

const isTree = (catalogId: string): boolean => itemRole(getCatalogItem(catalogId)) === 'canopy';


export type { KitGround, PlantMark };
