/**
 * Stage 4 of the methodology pipeline (步骤 4 · 细节点缀): the regions filled in.
 *
 * A REGION IS A RUN OF OPEN GROUND, not a rectangle. The lots the layout drew are where a region was
 * PLANNED; what it actually gets is whatever open ground survives the terrain, the roads and the
 * buildings, and that is what the reference maps are measured over too: a connected run of open land
 * cut by pavement, water and terrace step, median 48 cells on the target island. So the dressing pass
 * segments the finished map into those runs, gives each one to the region whose lot holds most of it,
 * and composes it with that region's kit. A run no lot reaches is left bare — which is what makes
 * decoration read as composed PLACES rather than as ground cover.
 *
 * ONE AUTHOR PER RUN is the reason the assignment matters: the two soft rules being aimed at are
 * local symmetry and per-region unity, and both are measured over exactly these runs. A run planted
 * by two regions could satisfy neither, however carefully each had composed its own half.
 *
 * HOW MUCH is a budget, not a per-region taste: the map is planted to a decoration density in the
 * band the two references share (0.07 to 0.095 per land cell), and each kit's `appetite` only says
 * how that budget is shared out. What separates this generator's maps from the references is the
 * ARRANGEMENT rather than the amount, so the volume knob is set once and the kits argue about
 * arrangement.
 *
 * Everything is placed through `tryDecorate`, so the rules judge every plant and a refusal changes
 * nothing; the ground features a kit wants (pools, a sunken court, a terrace ring) are declared here
 * and cut by `terrain-sculpt.ts` long before, since terrain must be down before a road or a plant is.
 */
import { makeRng, type Rng } from '../../../../core/model/rng';
import { flatIndex } from '../../../../core/model/grid-model';
import { CellZone, ItemCategory, TerrainType, type Rect } from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import { getRotatedSize, objectRect } from '../../../../state/object-geometry';
import { tryDecorate, tryPlace, type PlaceCtx } from '../../../placement/object';
import type { AnchorPlan } from '../places/anchors';
import { streetTermini } from '../eval/streets';
import { familyOf, planPalettes, speciesOf, type RegionPalette } from './palette';
import { composesFormally, mirrorOf, symmetrize, type Axis } from './symmetry';
import { plantableSurface } from '../terrain/terrain-sculpt';
import type { AnchorKind, DesignPlan, RegionPlan, ThemeId } from '../types';
import { anchorStyle, hedgeMarks } from './anchor';
import { boxOf, compose } from './elements';
import { foodLeisureStyle } from './food-leisure';
import { natureStyle } from './nature';
import { productionStyle } from './production';
import { viewpointStyle } from './viewpoint';
import { cultureStyle } from './culture';
import type { KitCanvas, KitGround, KitStyle, PlantMark } from './types';

// --- tunables ------------------------------------------------------------------------------------

/** Decoration per land cell at richness 0 and 1. The two references measure 0.073 (the terraced
 *  target) and 0.092 (the flat garden town), for a band of 0.07 to 0.095. The aim sits a little inside
 *  that band rather than on its floor: what a run can actually plant is bounded by the ground the
 *  terrain left it, so a map that cannot reach its aim lands UNDER it, and an aim on the floor puts the
 *  seeds that fall short outside the band. The ceiling is 0.088 rather than 0.090 because the eroded
 *  terrace edges cut the island into more runs, and at 0.090 the densest seed lands at 0.0955, just over
 *  the band's own ceiling. */
const DENSITY = { min: 0.072, max: 0.088 } as const;
/** What share of a composed mark the rules actually accept. The pass reads the ground before it
 *  composes, so the two only differ where a plant's own sweep disagrees with the reading; the budget
 *  is divided by it so the map lands in the band rather than just under it. */
const YIELD = 0.98;
/** Bounds on one run's cover, whatever the budget says: a run planted edge to edge is a carpet, and
 *  one planted below this is not a composed place at all. */
const COVER = { min: 0.08, max: 0.9 } as const;

/**
 * How long a bank row runs, and how deep from the water it is drawn.
 *
 * 93% of the style target's near-water planting is same-species straight runs, and the length
 * histogram is dominated by 5s and 6s. So a bank is planted as rows of one species rather than as
 * whatever the kit's tiling happened to put there — which is the whole difference between water a map
 * is composed AROUND and water a map merely contains.
 */
const BANK_RUN = { min: 5, max: 6 } as const;
const BANK_DEPTH = 2;
/** How much of a run's own planting budget the banks may take. The rows are drawn outside the cover
 *  the budget correction scales, so without a cap a watery place plants its shores AND its beds and
 *  the map's decoration density lands over the references' band. */
const BANK_SHARE = 0.5;
/** How often a bank row alternates two species of its family instead of running one. The target
 *  carries both grammars: 101 same-species runs at step 1, plus framed troughs alternating every row.
 *  A third, so the single-species run stays the dominant reading. */
const BANK_ALTERNATE = 0.34;
/** How far ahead of a street's end its composed spot is planted, and how many marks it takes. Four
 *  is what the arrival reading looks for; the reach is the reading's own. */
const END_REACH = 3;
const END_MARKS = 5;
/** How far past its lot a region's claim reaches when a run is being assigned an owner. A run of open
 *  ground is cut by the streets and the terraces rather than by the layout, so it rarely lines up
 *  with a lot; this is the margin within which a run still counts as part of the place beside it. */
const APRON = 10;
/** Share of runs OFFERED a mirror. The style target carries a detectable mirror in two thirds of its
 *  decorated regions, so the aim is that band and not every region — and the share is higher than
 *  that band because `FORMAL_FILL` turns some of the offers down. */
const FORMAL_SHARE = 0.75;
/** What share of a canvas the kit's blocks actually stand on. They are laid with a cell of air
 *  between them (`elements.ts:TILE_GAP`), so a 5x5 block grid covers about 0.69 of its ground and a
 *  7x6 one about 0.75. */
const TILE_YIELD = 0.7;
/** How much of its own bounding box a run must fill to be worth mirroring at all. */
const FORMAL_FILL = 0.5;
/** A run smaller than this is not a place; it is a gap between two of them. Eight rather than a
 *  dozen because a terraced island's open ground comes in smaller pieces than a plain's: the runs
 *  between a step, a street and a pool are what most of a rich map is made of, and dropping them
 *  leaves it thinner than the density band both references share. */
const RUN_MIN_CELLS = 8;
/**
 * FLOWERS PER TREE at richness 0 and 1, and the axis the two references sit at either end of.
 *
 * The flat garden town measures 1 : 6.6 and the terraced target 1 : 1.12, which makes the ratio a style
 * axis rather than a number to average. Richness is that axis: a quiet map is a garden town, a full one
 * is the island. It runs BACKWARDS if the trees share the cover ladder, since one step of a shared
 * ladder trades three quarters of a block's trees for four times its blooms.
 */
const TREE_RATIO = { min: 6.6, max: 1.4 } as const;
/** The forecourt an arrival building takes: cells deep into the lot, and its widest span. */
const FORECOURT = { deep: 3, span: 8 } as const;

// --- what a kit wants of the ground ----------------------------------------------------------------

/** The quiet treatment: an edge run and open ground. Its appetite is a fraction of a themed place's,
 *  so a map whose blocks are mostly quiet reads as ground with edges rather than as a carpet. */
const QUIET_STYLE: KitStyle = {
  tile: { w: 6, h: 5 },
  mix: [['border', 3], ['open', 5], ['bed', 1]],
  appetite: 0.35,
};

/** The planting a water place's dry strips take: 5-wide solid blocks and period-2 two-species rows,
 *  which is what the reference's water gardens are planted with. */
function waterStyle(rng: Rng): KitStyle {
  return {
    tile: { w: 5, h: rng.int(2) === 0 ? 6 : 3 },
    mix: rng.int(2) === 0
      ? [['bed', 4], ['rows', 2], ['open', 1]]
      : [['checker', 3], ['bed', 3], ['open', 1]],
    appetite: 1.1,
  };
}

/**
 * The style one region is built in. Anchors dispatch by their kind, themes by their family, and the
 * two TREATMENTS stage C can put on a place answer before either.
 *
 * QUIET is the treatment a block gets where nothing claimed it: a border run along its edge and open
 * ground inside, which is the garden town's own way of saying where a plot ends. It is a treatment
 * rather than an absence — every block on a finished map was decided about.
 *
 * WATER is the treatment of a block the sculptor floored with a comb, a ring or a trough. The ground
 * it leaves is narrow dry strips, so the kit plants them the way the reference does: solid
 * single-species blocks and two-species alternating rows, kept inside one colour family.
 */
export function styleOf(region: RegionPlan, rng: Rng): KitStyle {
  if (region.quiet) return QUIET_STYLE;
  if (region.water) return waterStyle(rng);
  if (region.kind !== 'theme') return anchorStyle(region.kind as AnchorKind, rng);
  const theme = region.themeId as ThemeId;
  switch (region.family) {
    case 'food-leisure': return foodLeisureStyle(theme as never, rng);
    case 'nature': return natureStyle(theme as never, rng);
    case 'viewpoint': return viewpointStyle(theme as never, rng);
    case 'culture': return cultureStyle(theme as never, rng);
    default: return productionStyle(theme as never, rng);
  }
}

/** Every region's ground wants. Richness scales the water: a low-richness map is the flat garden
 *  town, which carries a lake and two channels rather than a pool per region. */
export function planKitGround(plan: DesignPlan, seed: number, richness: number): KitGround[] {
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

export interface DressInput {
  place: PlaceCtx;
  plan: DesignPlan;
  anchors: AnchorPlan;
  seed: number;
  richness: number;
  /** The network's dominant material, for the forecourts an arrival building takes. */
  material: string;
  /** Cells no composition may plant on, as flat indices. The landmark's panel is the one caller:
   *  a stroke two cells wide carries plantable ground down its middle, and a plant standing there
   *  is a letter that cannot be read. */
  avoid?: ReadonlySet<number>;
  /** The painted region a scoped run is confined to. It gates the GROUND rather than the marks, so
   *  a composition is built on the ground the region actually offers — a mark filter applied
   *  afterwards would cut mirrored pairs in half and leave the region reading as a torn edge of a
   *  composition made for somewhere else. */
  within?: (x: number, y: number) => boolean;
}

export interface DressOutcome {
  planted: number;
  /** Plants the rules turned down. A composed mark stands on ground the pass already read as
   *  plantable, so this counts the cases the reading and the rules disagree on. */
  refused: number;
  /** Forecourt cells paved beside the museum and the shop. */
  paved: number;
  /** Runs of open ground composed, and how many of those were composed as a mirror. */
  composed: number;
  formal: number;
}

export function dressRegions(input: DressInput): DressOutcome {
  const { place, plan, anchors, seed } = input;
  const state = place.state;
  const W = state.template.width, H = state.template.height;
  const surface = plantableSurface(state);
  const out: DressOutcome = { planted: 0, refused: 0, paved: 0, composed: 0, formal: 0 };
  // The forecourts go down BEFORE the ground is read: they are pavement, and pavement is one of the
  // things that decides where a plant may stand.
  out.paved = layForecourts(input, surface);

  const open = openGround(place, surface, input.avoid, input.within);
  const runs = segmentRuns(open, surface, W, H);
  const owners = assignRuns(runs, plan, W);
  const palettes = planPalettes(plan, seed);
  const byId = new Map(plan.regions.map((r) => [r.id, r] as const));

  // The budget, shared by appetite: `k` is the cover a run of appetite 1 gets, so the whole map lands
  // in the density band whatever the kits happened to be drawn.
  let land = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (state.cells[y]![x]!.zone === CellZone.Grass) land++;
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
  const budget = land * lerp(DENSITY.min, DENSITY.max, input.richness) / YIELD;
  const k = weight > 0 ? budget / weight : 0;

  const jobs: { canvas: KitCanvas; style: KitStyle; region: RegionPlan; formal: boolean; axis: Axis }[] = [];
  for (const owned of owners) {
    const region = byId.get(owned.regionId);
    const palette = palettes.get(owned.regionId);
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
      cover: clamp(k * style.appetite, COVER.min, coverCap(treeWeight(style))),
      // A KIT'S OWN MIX SETS WHERE THE TREES START. A tree avenue asks for lattices and a flower
      // field asks for beds, so each region opens at the share of its own mix that is tree blocks
      // and the map-level correction below scales every region from there — which moves the ISLAND'S
      // ratio to the axis without flattening one theme into another.
      treeShare: treeWeight(style),
      orientation: region.orientation,
      palette,
      rng,
    };
    jobs.push({
      canvas, style, region,
      // A RAGGED RUN IS NEVER COMPOSED FORMALLY. A mirror only stands where both halves can be
      // planted, so on a run that wanders round a terrace most of its pairs fall on ground that is
      // not there — the marks are dropped, the region reads as neither mirrored nor full, and the
      // composition pays for a symmetry it did not get.
      formal: canvas.cells.size >= FORMAL_FILL * canvas.box.w * canvas.box.h
        && composesFormally(rng, FORMAL_SHARE),
      axis: rng.int(2) === 0 ? 'v' : 'h',
    });
  }

  // THE BUDGET IS SPENT, THEN COUNTED, THEN SPENT AGAIN, and the ratio rides the same correction.
  // What a cover actually plants depends on the elements the blocks were drawn as and on how much of
  // the mirror the ground could carry, so the first pass is an estimate: each later one scales every
  // cover by how far the last overshot or fell short, and every tree share by how far the map's
  // trees-to-flowers landed from the axis. Composing is pure and cheap, and the corrections land
  // both readings on every seed rather than on most of them.
  const wanted = land * lerp(DENSITY.min, DENSITY.max, input.richness) / YIELD;
  const wantTrees = 1 / (1 + lerp(TREE_RATIO.min, TREE_RATIO.max, input.richness));
  const water = waterMask(state);
  let composed = jobs.map((job) => composeRun(job, anchors, W, water));
  // A PATH ENDS AT SOMETHING. The street planner cuts back every end it can, but an end that is a
  // block's only frontage has to stay — and what the references do with such an end is compose at
  // it. So the last thing planted on a map is a small group at each street end that has nothing in
  // front of it, in the palette of whichever region owns the ground there.
  // The region that OWNS the ground, the same answer `assignRuns` gave: an end spot drawn from a
  // neighbour's palette is a species the run it stands in does not otherwise plant, which is the one
  // thing the unity reading is looking for.
  const ownerOf = new Map<number, string>();
  for (const owned of owners) for (const i of owned.cells) ownerOf.set(i, owned.regionId);
  const ends = endMarks(input, surface, open, palettes, ownerOf, plan, W,
    new Set(jobs.filter((j) => j.formal).map((j) => j.region.id)));
  for (let pass = 0; pass < 3; pass++) {
    // The end spots count against the same budget: they are marks on the map, and leaving them out
    // of the correction puts a map over the references' decoration band by exactly their number.
    const total = composed.reduce((a, marks) => a + marks.length, 0) + ends.length;
    if (total === 0) break;
    let trees = 0;
    for (const marks of composed) for (const m of marks) if (isTree(m.catalogId)) trees++;
    const density = wanted / total;
    const ratio = trees > 0 ? wantTrees / (trees / total) : 2;
    if (Math.abs(density - 1) <= 0.05 && Math.abs(ratio - 1) <= 0.08) break;
    for (const job of jobs) {
      job.canvas.treeShare = clamp(job.canvas.treeShare * ratio, 0, 1);
      job.canvas.cover = clamp(job.canvas.cover * density, COVER.min, coverCap(job.canvas.treeShare));
    }
    composed = jobs.map((job) => composeRun(job, anchors, W, water));
  }

  const taken = new Set<number>();
  for (const [index, job] of jobs.entries()) {
    out.composed++;
    if (job.formal) out.formal++;
    for (const mark of composed[index]!) {
      taken.add(flatIndex(mark.x, mark.y, W));
      if (tryDecorate(place, mark.catalogId, mark.x, mark.y)) out.planted++;
      else out.refused++;
    }
  }
  for (const mark of ends) {
    if (taken.has(flatIndex(mark.x, mark.y, W))) continue;
    if (tryDecorate(place, mark.catalogId, mark.x, mark.y)) out.planted++;
    else out.refused++;
  }
  return out;
}

/**
 * The composed spot at the end of a path.
 *
 * `streetTermini` reads the finished pavement for the ends a street stops at; each one takes a short
 * block of one species on the open ground straight ahead of it, drawn from the palette of the region
 * whose lot is nearest. It is the smallest composition the kits make and it is the one the arrival
 * reading is looking for: a walk that ends somewhere rather than in grass.
 */
function endMarks(
  input: DressInput, surface: Int8Array, open: Uint8Array,
  palettes: ReadonlyMap<string, RegionPalette>, ownerOf: ReadonlyMap<number, string>,
  plan: DesignPlan, W: number, formal: ReadonlySet<string>,
): PlantMark[] {
  const out: PlantMark[] = [];
  const done = new Set<number>();
  for (const end of streetTermini(input.place.state)) {
    const ahead = end.face
      .map((c) => flatIndex(c.x + end.dx, c.y + end.dy, W))
      .map((i) => ownerOf.get(i))
      .find((id) => id !== undefined);
    // Where the ground ahead belongs to no run — too small to compose on, which is exactly where a
    // walk ends at nothing — the nearest region's palette stands in.
    const regionId = ahead
      ?? nearestRegion(plan, end.face.map((c) => flatIndex(c.x, c.y, W)), W);
    // NOT INTO A MIRRORED PLACE. A spot at a street's end stands on the region's edge rather than
    // inside its composition, so in a formally composed region it is a mark the mirror cannot
    // account for. Those regions are dense enough that a walk arrives at them anyway.
    if (formal.has(regionId)) continue;
    const palette = palettes.get(regionId);
    if (!palette) continue;
    const id = palette.species('mass');
    if (getCatalogItem(id)?.traits?.some((t) => t.type === 'exclusionRadius')) continue;
    // Centre of the face outward, so the block comes out MIRRORED about the street's own axis: an
    // end spot laid greedily from one side is an asymmetry dropped into a region the composition
    // score reads as a whole.
    // The spot is laid where a WALKER coming down the street sees it: within a cell of the street's
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
        done.add(i);
        out.push({ x, y, catalogId: id });
        laid++;
      }
    }
  }
  return out;
}

/** One run composed: its kit's tiling, mirrored where the run is a formal one, with an anchor
 *  region's hedges laid round its buildings first. Each cell is asked for once. */
function composeRun(
  job: { canvas: KitCanvas; style: KitStyle; region: RegionPlan; formal: boolean; axis: Axis },
  anchors: AnchorPlan, W: number, water?: Uint8Array,
): PlantMark[] {
  const { canvas, region } = job;
  let marks = compose(canvas, job.style, job.formal ? job.axis : null);
  // THE BANK IS PART OF THE COMPOSITION, so it is laid before the mirror rather than dropped on top
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
  // ONE MARK PER FOOTPRINT, not per anchor cell. A tree is not always 1x1, and the bank rows are
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

/**
 * The rows a run plants along its water.
 *
 * WHICH BANK is not a matter of taste. A plant validates its own cell plus one column right and one
 * row below, so a cell with water to its east or south can never carry one, and the style target shows
 * the built consequence exactly: every one of its 299 water-adjacent plants has the water to its north
 * or west, and none has it to the east, south or south-east. So the rows are drawn on the banks the
 * sweep leaves standing, and nowhere else.
 *
 * A row runs ALONG the water it is drawn beside and is one species from end to end. Rows are laid
 * from the water outward to `BANK_DEPTH`: 2 cells rather than 1 covers 50% of the target's planting.
 */
function bankMarks(canvas: KitCanvas, water: Uint8Array, W: number, H: number): PlantMark[] {
  const out: PlantMark[] = [];
  const done = new Set<number>();
  const budget = Math.max(0, Math.round(BANK_SHARE * canvas.cover * canvas.cells.size));
  // A row index is not a bounds check: (x - k) on row y with a negative x reads the end of row y-1,
  // which would answer "water" for a cell on the other side of the map.
  const wet = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && water[flatIndex(x, y, W)] === 1;
  /** The direction the water lies in from a plantable cell, or null where it is not a bank. */
  const bankAt = (x: number, y: number): 'north' | 'west' | null => {
    for (let k = 1; k <= BANK_DEPTH; k++) {
      for (const dx of [-1, 0, 1]) if (wet(x + dx, y - k)) return 'north';
      if (wet(x - k, y) || wet(x - k, y + 1)) return 'west';
    }
    return null;
  };
  // A ROW IS A ROW OF ONE SPECIES, so the species has to be one that may stand beside itself: an
  // item carrying `exclusionRadius` refuses its own neighbour, and a run of it is a run of refusals
  // the composed mirror then reads as holes.
  const rowable = (id: string): boolean =>
    !getCatalogItem(id)?.traits?.some((t) => t.type === 'exclusionRadius');
  const pick = (...ids: string[]): string | null => ids.find(rowable) ?? null;
  const species = pick(canvas.palette.species('mass'), canvas.palette.species('edge'));
  const edge = pick(canvas.palette.species('edge'), canvas.palette.species('mass'));
  const grove = pick(canvas.palette.species('grove'), canvas.palette.species('grove-accent'));
  for (const i of [...canvas.cells].sort((a, b) => a - b)) {
    if (out.length >= budget) break;
    if (done.has(i)) continue;
    const x = i % W, y = (i / W) | 0;
    const side = bankAt(x, y);
    if (!side) continue;
    // A row runs along the shore: across a bank whose water is north, down one whose water is west.
    const [dx, dy] = side === 'north' ? [1, 0] : [0, 1];
    const length = BANK_RUN.min + canvas.rng.int(BANK_RUN.max - BANK_RUN.min + 1);
    // A share of the rows is TREES at step 2, which is how the target plants its own waterside (101
    // same-species runs at step 1 and 32 at step 2, and the comb's dry ridges each holding one peach).
    // It is also what keeps the bank from planting flowers only: the rows are a large share of a watery
    // map's decoration, and a flower-only bank drags the whole island's trees-to-flowers ratio off the
    // axis whatever the kits do.
    const treeRow = canvas.rng.float() < canvas.treeShare && grove !== null;
    const id = treeRow ? grove : (canvas.rng.int(3) === 0 ? edge : species) ?? species ?? edge;
    if (!id) continue;
    const step = treeRow ? 2 : 1;
    // AND A SHARE OF THE ROWS ALTERNATES TWO SPECIES OF ONE FAMILY. The target's richest water gardens
    // are beds of two 5-wide single-species blocks side by side, or three rows of a two-species
    // period-2 alternation kept inside one colour family, and the framed troughs below them alternate
    // to the last row. A row of one species and a row of two read as the same grammar at map scale
    // precisely because the two species share a family: what alternates is the plant, never the colour.
    const pair = treeRow ? null : alternation(canvas, id);
    for (let k = 0; k < length; k++) {
      const cx = x + dx * k * step, cy = y + dy * k * step;
      const j = flatIndex(cx, cy, W);
      if (!canvas.cells.has(j) || done.has(j) || !bankAt(cx, cy)) break;
      done.add(j);
      out.push({ x: cx, y: cy, catalogId: pair ? pair[k % 2]! : id });
    }
  }
  return out;
}

/**
 * The two species one row alternates between, or null where this row is a single-species one.
 *
 * The second species is drawn from the SAME colour family as the first, since the alternation is in the
 * plant and never in the colour, and it must be able to stand beside a neighbour for the same reason a
 * single-species row's species must. A family that offers only one such flora answers null, and the row
 * runs a single species.
 */
function alternation(canvas: KitCanvas, first: string): [string, string] | null {
  if (canvas.rng.float() >= BANK_ALTERNATE) return null;
  const family = familyOf(first);
  const second = speciesOf(ItemCategory.Flora, family)
    .find((id) => id !== first && !getCatalogItem(id)?.traits?.some((t) => t.type === 'exclusionRadius'));
  return second ? [first, second] : null;
}

/** Water on the finished map, as a mask the bank rows are drawn against. */
function waterMask(state: PlaceCtx['state']): Uint8Array {
  const W = state.template.width, H = state.template.height;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = state.cells[y]![x]!.terrain;
      if (t && t.type === TerrainType.Water) out[flatIndex(x, y, W)] = 1;
    }
  }
  return out;
}

// --- reading the finished map -----------------------------------------------------------------------

/**
 * Open ground a plant may stand on: buildable land whose flat sweep is level and dry, with nothing
 * standing on it and nothing about it that `tryDecorate` would refuse.
 *
 * The last part is why the gate is repeated here rather than left to the placer: a mark the rules
 * turn down is a hole in a mirrored composition, so the ground has to be read the same way the
 * placement will judge it. Two cells are open but unplantable — one reserved as clearance at a door
 * or a crossing end, and one with pavement on two or more sides, which is a median strip or a pocket
 * a looping street encloses rather than a curb.
 */
function openGround(
  place: PlaceCtx, surface: Int8Array, avoid?: ReadonlySet<number>,
  within?: (x: number, y: number) => boolean,
): Uint8Array {
  const state = place.state;
  const W = state.template.width, H = state.template.height;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      if (surface[i]! < 0 || state.cells[y]![x]!.zone !== CellZone.Grass) continue;
      if (place.clearance.has(i) || avoid?.has(i)) continue;
      if (within && !within(x, y)) continue;
      let paved = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && place.roads.has(flatIndex(nx, ny, W))) paved++;
      }
      if (paved < 2) out[i] = 1;
    }
  }
  for (const o of state.objects.values()) {
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) out[flatIndex(x, y, W)] = 0;
      }
    }
  }
  return out;
}

/** The runs of open ground, cut wherever the surface elevation changes: the same segmentation the
 *  symmetry and unity scores are measured over, here and on the references. */
function segmentRuns(open: Uint8Array, surface: Int8Array, W: number, H: number): number[][] {
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  for (let s = 0; s < W * H; s++) {
    if (!open[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    const cells: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = flatIndex(nx, ny, W);
        if (!open[j] || seen[j] || surface[j] !== surface[p]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (cells.length >= RUN_MIN_CELLS) {
      cells.sort((a, b) => a - b);
      out.push(cells);
    }
  }
  return out;
}

/** A lot with its apron: the ground a region composes. */
const grounds = (region: RegionPlan): Rect | null => {
  const lot = region.lot[0];
  return lot
    ? { x: lot.x - APRON, y: lot.y - APRON, w: lot.w + 2 * APRON, h: lot.h + 2 * APRON }
    : null;
};

const within = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * Which region composes each run: the one whose lot-plus-apron covers most of it, and it composes
 * the WHOLE run.
 *
 * Whole, because the run is the unit the two soft rules are measured over — a region that planted
 * only the part of a run inside its own lot would leave the rest of that run bare and the composition
 * reading as a rectangle stamped on open ground.
 *
 * A run NO lot comes within an apron of goes to the nearest region rather than going bare. Leaving it
 * bare is the more principled answer on a plain — decoration should read as composed places rather
 * than as ground cover — but two fifths of a terraced island's plantable cells are terraces the layout
 * never planned a lot onto, and leaving all of those bare puts the map's decoration density at half the
 * band both references share. A far terrace composed in the nearest region's palette still reads as
 * that place's outskirt; the same terrace bare reads as unfinished.
 */
function assignRuns(runs: number[][], plan: DesignPlan, W: number): { run: number; regionId: string; cells: number[] }[] {
  const out: { run: number; regionId: string; cells: number[] }[] = [];
  for (const [index, cells] of runs.entries()) {
    let bestId = '', bestOverlap = 0;
    for (const region of plan.regions) {
      const ground = grounds(region);
      if (!ground) continue;
      let overlap = 0;
      for (const i of cells) if (within(ground, i % W, (i / W) | 0)) overlap++;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestId = region.id; }
    }
    if (!bestId) bestId = nearestRegion(plan, cells, W);
    if (bestId) out.push({ run: index, regionId: bestId, cells });
  }
  return out;
}

/** The region whose lot is nearest a run's own centre. Ties break on the region id, so the answer
 *  does not depend on the plan's order. */
function nearestRegion(plan: DesignPlan, cells: readonly number[], W: number): string {
  let sx = 0, sy = 0;
  for (const i of cells) { sx += i % W; sy += (i / W) | 0; }
  const cx = sx / cells.length, cy = sy / cells.length;
  let bestId = '', bestD = Infinity;
  for (const region of plan.regions) {
    const lot = region.lot[0];
    if (!lot) continue;
    const dx = Math.max(lot.x - cx, 0, cx - (lot.x + lot.w));
    const dy = Math.max(lot.y - cy, 0, cy - (lot.y + lot.h));
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && region.id < bestId)) { bestD = d; bestId = region.id; }
  }
  return bestId;
}

/** The footprints an anchor region's buildings stand on, for its hedges. */
function buildingRects(anchors: AnchorPlan, regionId: string): Rect[] {
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
 * It is laid ONLY where it meets pavement already down. A detached paved court would be a piece of
 * road network the plaza cannot reach, which is a hard-rule failure rather than an ornament, so the
 * scan would rather lay nothing.
 */
function layForecourts(input: DressInput, surface: Int8Array): number {
  const { place, plan } = input;
  const W = place.state.template.width, H = place.state.template.height;
  let paved = 0;
  for (const region of plan.regions) {
    if (region.kind !== 'museum' && region.kind !== 'shop') continue;
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
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (place.roads.has(flatIndex(c.x + dx, c.y + dy, W))) { touches = true; break; }
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

// --- small helpers ------------------------------------------------------------------------------------

/** A stable seed per (map seed, region id), so a region's style does not depend on how many regions
 *  were drawn before it. */
function regionSeed(seed: number, regionId: string): number {
  let h = (seed ^ 0x4b1d5eed) >>> 0;
  for (let i = 0; i < regionId.length; i++) h = Math.imul(h ^ regionId.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * The most of a run one composition may plant, given how much of what it plants must be trees.
 *
 * A tree block plants a quarter of itself, so asking for a tree share of `s` at a cover of `c`
 * commits `4sc` of the ground to lattices and leaves the rest for the flowers, which have to carry
 * `(1 - s)c` — solid at most. The two fit while `c <= 1 / (1 + 3s)`; past that the lattices take
 * ground the beds needed, the run plants a quarter of itself however high the cover goes, and the
 * map-level correction reads a thin map, raises the cover and thins it further.
 *
 * `TILE_YIELD` is in it because the blocks do not cover the canvas: a cell of air between them is
 * what makes a bed read as a bed, and a third of the ground is that air. Left out, the cap lands where
 * the tiling has already run out of blocks to give the trees, so every block on the canvas becomes a
 * lattice and the flowers get none.
 */
export const coverCap = (treeShare: number): number =>
  Math.min(COVER.max, TILE_YIELD / (1 + 3 * clamp(treeShare, 0, 1)));

/** The share of a kit's own draw weight that asks for a tree block. */
function treeWeight(style: KitStyle): number {
  let tree = 0, total = 0;
  for (const [kind, weight] of style.mix) {
    total += weight;
    if (kind === 'orchard' || kind === 'grove') tree += weight;
  }
  return total > 0 ? tree / total : 0;
}

const isTree = (catalogId: string): boolean =>
  getCatalogItem(catalogId)?.category === ItemCategory.Tree;

const lerp = (a: number, b: number, v: number): number => a + (b - a) * (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export type { KitGround, PlantMark };
