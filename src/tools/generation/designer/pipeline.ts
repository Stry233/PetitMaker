/**
 * The methodology generator's ORCHESTRATOR: the planning stages in order, then one commit through
 * the live rules.
 *
 *   composition/ (where the mass sits, and the walk through it)
 *     -> streets/ (the partition) -> places/ (which regions, where, and what stands in them)
 *     -> terrain/ + water/ (the ground realized) -> build/ (committed and placed)
 *     -> dressing/ (the places filled)
 *
 * Every stage above is pure data; this is the only file that ORDERS them, and `build/` is the only
 * one that touches a map. It touches it the way every other generator does — terrain through
 * `planToCommands` after the decrease-only repair fixpoint, every object through one `tryPlace`, so
 * the RuleRegistry judges each edit and a refusal changes nothing. There is no direct state
 * mutation anywhere in the pipeline.
 *
 * TERRAIN GOES DOWN BEFORE ANYTHING IS PLACED, and the whole PLAN is drawn before that. A road
 * coating validates the ground it lies on (the `flat` trait), so pavement and terrain cannot share a
 * cell; the order that follows is: draw the composition, the streets, the places and the buildings
 * ON PAPER, let the sculptor realize the ground all four stand on, commit that, and only then lay
 * the pavement and the objects onto the ground that was planned for them.
 *
 * Planning the streets BEFORE the ground is what lets the island be terraced rather than flat. A
 * network routed on a finished surface can only use the ground that stayed at elevation 0, so the
 * town has to be a plain for its roads to reach anything; a network planned on the plates rides them
 * instead, and a flight of ramps carries it between tiers.
 *
 * A REFUSAL IS A FINDING, NOT AN ACCIDENT. Everything the pipeline commits is legal by
 * construction — the tier field caps its own heights, the water is cut to shapes the rules cannot
 * refuse, the streets only run on ground a coating may be laid on, and a building stands inside one
 * district at one tier — so every count in `refused` should be zero; they are returned rather than
 * swallowed so a caller can fail on them instead of reading a thinner map as a successful one.
 *
 * Browser-API-free by construction (the worker-pool contract): nothing here reads the DOM, storage
 * or a clock, and the whole run is a function of (seed, richness, template).
 */
import { flatIndex } from '../../../core/model/grid-model';
import { makeRng } from '../../../core/model/rng';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import {
  type Command, type GridState, type MacroCoord, type Rect, type ValidationResult,
} from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { getRotatedSize } from '../../../state/object-geometry';
import { makeCtx, tryPlace } from '../../placement/object';
import { BRIDGE_COUNT, layBridges, layFlights, layLineDecks } from './build/crossings';
import {
  mouthPaved, paveApproach, paveBand, pavePlazaApron,
} from './build/paving';
import { makeScope } from './build/scope';
import { commitTerrain } from './build/terrain-commit';
import { planAnchors, type AnchorPlan } from './places/anchors';
import { planComposition, type CompositionPlan } from './composition/composition';
import { planDistricts, type DistrictAssignment } from './places/districts';
import { dressRegions, planKitGround, type DressOutcome } from './dressing';
import { frameCells, landmarkCells } from './terrain/landmark';
import { planMovementLine, type MovementLine } from './composition/movement-line';
import { planStreets, type StreetPlan } from './streets/streets';
import { pavableMask, plantableSurface, sculptTerrain, type TerrainSculpt } from './terrain/terrain-sculpt';
import type { DesignPlan } from './types';

/** What a designed run needs: the map, the executor's command door, and the rules that judge it.
 *  The same triple the placement populator threads, plus the numbers a plan is made from. */
export interface DesignedContext {
  state: GridState;
  execute: (c: Command) => ValidationResult;
  reg: RuleDispatcher;
  seed: number;
  /** 0..1 scenery richness: how many theme regions, how tall the wall, how much water, how many
   *  loops. */
  richness: number;
  /** The map's height ceiling; the wall's plateau never passes it. */
  maxElevation?: number;
  /** The island KIND, which is the shelf's own word for how much sea a map is: `earth` is dry land
   *  and takes no water at all, `water` spends more of the island on it. */
  mode?: 'earth' | 'water' | 'mixed';
  /**
   * The painted region a run is confined to, or null for the whole island.
   *
   * IT RESTRICTS AT COMMIT TIME AND NOWHERE ELSE, the one scope Generate and Clear share: the
   * ISLAND is always designed whole — the
   * regions, the wall, the network, the water story are laid out for the map — and the region then
   * crops what actually lands. So a region receives whatever the island design put there and no
   * more: one over the backing band legitimately comes back as mountain and nothing else, one over
   * the town comes back as streets and beds, and one over open ground the design left open
   * legitimately comes back empty.
   *
   * Designing INSIDE the region instead would make the scope a different generator rather than a
   * smaller run of the same one, and the two would disagree about the map they are on.
   */
  region?: MacroCoord[] | null;
}

export interface DesignedOutcome {
  /** Stage C's plan: the places, which is what every later stage reads. */
  plan: DesignPlan;
  /** Stage A: where the mass sits and the plates it stands on. */
  composition: CompositionPlan;
  /** The walk everything else was composed around. */
  line: MovementLine;
  /** Stage B: the streets, their flights and the districts they cut. */
  streets: StreetPlan;
  /** What each district was made into. */
  districts: DistrictAssignment[];
  sculpt: TerrainSculpt;
  anchors: AnchorPlan;
  /** Objects the map accepted: road tiles, buildings, court-lane tiles and crossings together. */
  placed: number;
  /** Terrain layers the plan asked for and how many the rules turned down. */
  terrain: { commands: number; refused: number };
  /** Placements the rules refused, by kind. Zero on a sculpt the router read; anything else is a
   *  defect. `crossings` counts the approach a landed deck asked for and did not get: the deck
   *  itself is placed by a generous scan whose refusals are the scan working, but a bridge whose
   *  approach was refused is a bridge the walk stops at. */
  refused: { roads: number; anchors: number; lanes: number; crossings: number };
  /** The ramps the streets' flights asked for, and the bridges laid where a channel runs. */
  crossings: { ramps: number; bridges: number };
  /** Ramps whose stored footprint is not the one the street plan drew. Zero on a plan the trait
   *  resolved as expected; anything else means a corridor was cleared in the wrong place. */
  rampsMisplaced: number;
  /** Court lanes whose mouth reached no pavement, so they were not laid: laying one would leave a
   *  paved island the plaza cannot reach, which is a hard-ledger failure rather than a rough edge. */
  lanesSkipped: string[];
  /** Anchors whose door opens onto unpaved ground once everything is down. */
  unroadedGates: { regionId: string; catalogId: string }[];
  /** What the theme kits planted, and how many of the runs they composed were mirrored. */
  dressing: DressOutcome;
}

/** The cells no kit may plant on: the landmark's panel and the open court around every fountain. */
function keepClear(sculpt: TerrainSculpt, W: number, H: number): Set<number> {
  const out = sculpt.landmark ? landmarkCells(sculpt.landmark, W, H) : new Set<number>();
  // AND THE FRAME AROUND IT. What makes a figure read as figure against ground is the calm band round
  // its edge — the reference frames its banner on four sides — and the evaluation reads that band as
  // PAVED OR BARE. A bed planted against the panel's edge is the framing gone, and one seed reads 67% of
  // its band calm that way against the floor of 70%.
  if (sculpt.landmark) {
    for (const c of frameCells(sculpt.landmark, W, H)) {
      if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) out.add(flatIndex(c.x, c.y, W));
    }
  }
  for (const court of sculpt.fountains) {
    if (court.size !== 'large') continue;
    for (let y = court.rect.y; y < court.rect.y + court.rect.h; y++) {
      for (let x = court.rect.x; x < court.rect.x + court.rect.w; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) out.add(flatIndex(x, y, W));
      }
    }
  }
  // THE MAP'S SET PIECE IS WHICHEVER WATER READS LARGEST, and that is not always the landmark: on one
  // seed a composed figure of 339 cells outweighs a 46x8 panel whose pattern stands mostly dry, and the
  // framing floor is then read round a body nothing kept clear. So the
  // biggest composed figure keeps a band of its own. ONLY the biggest: every figure ringed would take
  // a tenth of the island's plantable ground out of the kits' hands, and the reference gathers its own
  // planting at the banks.
  const largest = sculpt.figures.reduce<typeof sculpt.figures[number] | null>(
    (big, f) => (!big || f.cells.length > big.cells.length ? f : big), null,
  );
  if (largest) {
    for (let y = largest.rect.y - FIGURE_CALM; y < largest.rect.y + largest.rect.h + FIGURE_CALM; y++) {
      for (let x = largest.rect.x - FIGURE_CALM; x < largest.rect.x + largest.rect.w + FIGURE_CALM; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) out.add(flatIndex(x, y, W));
      }
    }
  }
  return out;
}

/** The calm band a composed figure keeps, in cells: the depth `eval/figure.ts:FRAME_READ` reads the
 *  framing over. */
const FIGURE_CALM = 3;

/**
 * THE COURT IS PAVED ON THE SIDE THE WALK ARRIVES FROM, never all the way round.
 *
 * A COURT STANDS AT A STREET'S END OR OFF ITS FLANK, NEVER ASTRIDE IT. The court's own ground is
 * reserved before a street is laid, so no street can cross it — but a border paved as a full ring is a
 * LOOP, and the network then routes through it: on `tafa/777` at full richness, the one failing map of
 * sixty, removing the band costs the network 212 further cells. So the apron is the half of the margin on
 * the arrival's side of the court's centre, which is a forecourt rather than a roundabout.
 */
function courtApron(court: { frame: MacroCoord[]; centre: MacroCoord; arrival: MacroCoord }): MacroCoord[] {
  const ux = court.arrival.x - court.centre.x, uy = court.arrival.y - court.centre.y;
  if (ux === 0 && uy === 0) return court.frame;
  return court.frame.filter((c) => (c.x - court.centre.x) * ux + (c.y - court.centre.y) * uy > 0);
}

/** The cells an object of `catalogId` would cover if placed at (x, y) with `rotation`. */
function footprintOf(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270): Rect {
  const item = getCatalogItem(catalogId);
  if (!item) return { x, y, w: 1, h: 1 };
  const size = getRotatedSize(item, rotation);
  return { x, y, w: size.w, h: size.h };
}

export function generateDesigned(ctx: DesignedContext): DesignedOutcome {
  const { state, seed, richness } = ctx;
  const scope = makeScope(ctx.region, state.template.width, state.template.height);
  // A -> B -> C: where the mass sits, the streets that partition it, the treatment every block takes.
  // Each stage reads the one before it and nothing reads the map, so the whole plan exists before a
  // single command does.
  const composition = planComposition(seed, state.template, richness, ctx.maxElevation);
  // The walk is drawn between the composition and the streets, which is the methodology's own order —
  // direction and movement line, before anything is built: the streets lay it as their first and
  // widest trunk, the sculptor puts the water it asks for beside it, and stage C meets its stops in
  // the order a visitor does.
  const line = planMovementLine(seed, state.template, composition, richness);
  const streets = planStreets(seed, state.template, composition, richness, line);
  const districts = planDistricts(seed, state.template, composition, streets, richness, undefined, line);
  const plan = districts.design;
  const anchors = planAnchors(seed, plan);
  const ground = planKitGround(plan, seed, richness);
  const sculpt = sculptTerrain({
    template: state.template, composition, streets, plan, anchors, seed, richness, ground, line,
    waterScale: WATER_SCALE[ctx.mode ?? 'mixed'],
    ...(ctx.maxElevation !== undefined ? { maxElevation: ctx.maxElevation } : {}),
  });
  const terrain = commitTerrain(ctx, sculpt, ctx.region ?? null);
  const pavable = pavableMask(state);
  const surface = plantableSurface(state);

  const place = makeCtx(state, ctx.execute, ctx.reg, seed);
  const refused = { roads: 0, anchors: 0, lanes: 0, crossings: 0 };
  let placed = 0;

  // ROADS FIRST, exactly as the plan lays them out: the network is what every place is reached by,
  // and a building placed onto pavement is a placement `tryPlace` would refuse anyway.
  for (const cell of streets.cells) {
    if (!scope.cell(cell.x, cell.y)) continue;
    if (tryPlace(place, cell.material, cell.x, cell.y)) placed++;
    else refused.roads++;
  }

  // THE PLAZA IS THE HUB, so the network reaches it even where stage B could lay no street along its
  // ring: a short 2-wide course from the plaza's own edge out to the nearest pavement. It costs
  // nothing on a map whose trunks already run against the plaza, which is nearly every one.
  placed += pavePlazaApron(place, pavable, surface, streets.materials.dominant, scope);

  // THE RAMPS ARE THE STREETS' OWN, and the only ones on the map, so none is ever overused or left
  // standing on a road. Each one is placed by its ANCHOR, because the `heightDrop`
  // trait resolves position and rotation from the cliff it finds — so what the plan drew is checked
  // against what the engine stored rather than assumed.
  const ramps = layFlights(place, streets, scope);

  // The buildings. `tryPlace` reserves and sweeps each house's gate strip as it lands, so the next
  // one in the same court cannot be dropped across its neighbour's doorstep.
  for (const p of anchors.placements) {
    const foot = footprintOf(p.catalogId, p.position.x, p.position.y, p.rotation);
    if (!scope.rect(foot.x, foot.y, foot.w, foot.h)) continue;
    if (tryPlace(place, p.catalogId, p.position.x, p.position.y, p.rotation)) placed++;
    else refused.anchors++;
  }

  // EVERY DOOR OPENS ON A ROAD, and the lot's own frontage is what usually provides it. Where stage
  // C could only fit a lot without a paved edge, the doorstep is joined to the network here: a
  // 2-wide course along the doorstep's own terrace, so the way to the door is a street rather than a
  // path one cell wide.
  for (const p of anchors.placements) {
    if (place.roads.has(flatIndex(p.approach.x, p.approach.y, state.template.width))) continue;
    placed += paveApproach(place, pavable, surface, streets.materials.dominant, p.approach, scope, DOOR_REACH);
  }

  // The court lanes: they run between buildings that are now down, and a lane is only laid where
  // its mouth actually meets the frontage the road plan reached the lot with.
  const lanesSkipped: string[] = [];
  for (const lane of anchors.lanes) {
    // A lane joins the network at its mouth or it is a paved island. Where the lot's frontage did
    // not reach the mouth, the same course a doorstep takes is run out to the streets first.
    if (!mouthPaved(place.roads, state, lane)) {
      for (const c of lane.mouth) {
        placed += paveApproach(place, pavable, surface, streets.materials.dominant, c, scope);
        if (mouthPaved(place.roads, state, lane)) break;
      }
    }
    if (!mouthPaved(place.roads, state, lane)) { lanesSkipped.push(lane.regionId); continue; }
    for (const c of lane.cells) {
      if (!scope.cell(c.x, c.y)) continue;
      // A cell the frontage spur already paved is a street, not a lane the rules turned down: two
      // coatings on one cell is a state nothing may create, so the lane simply joins what is there.
      if (place.roads.has(flatIndex(c.x, c.y, state.template.width))) continue;
      if (tryPlace(place, streets.materials.dominant, c.x, c.y)) placed++;
      else refused.lanes++;
    }
  }

  // THE FIGURE IS FRAMED IN PAVEMENT, and the course that reaches it is the walk ARRIVING at the map's
  // one set piece. The reference frames its banner on four sides with a road border, which is the whole
  // difference between a signboard and a lake; and because the figure stands on a
  // high terrace, its frame is also the pavement that puts the walk above the ground floor.
  //
  // IT IS PAVED ONLY WHERE IT CAN JOIN THE NETWORK. A ring nothing reaches is a paved island, which the
  // hard ledger reads as unreachable pavement and a visitor reads as scenery; where no course gets
  // there the frame stays the open terrace it was reserved as, which frames the figure just as well.
  // ONE CONNECTED PIECE OF IT, never the whole band: a frame cell the terrain or a lot took cuts the
  // band into arcs, and an arc the course never reached is pavement the plaza cannot walk to — which
  // the hard ledger reads as unreachable pavement and as tip cells at both its ends. So the arcs are
  // found first and only the one the network joins is paved.
  const figure = sculpt.landmark;
  const W0 = state.template.width;
  const onGround = (band: MacroCoord[], tier: number): MacroCoord[] => band
    .filter((c) => scope.cell(c.x, c.y) && pavable[flatIndex(c.x, c.y, W0)] === 1
      && surface[flatIndex(c.x, c.y, W0)] === tier);
  if (figure) {
    placed += paveBand(
      place, pavable, surface, streets.materials.dominant,
      onGround(frameCells(figure, W0, state.template.height), figure.tier),
      scope, FRAME_REACH, FRAME_ARC_MIN,
    );
  }

  // AND THE SAME BORDER ROUND EVERY LARGE FOUNTAIN COURT. A large fountain is composed with a whole
  // court around it, and a court is a BUILT space: water in the middle, a figure standing in the water,
  // and pavement round the whole of it. Left as the bare terrace it is reserved as, the composition reads
  // on a finished map as a pond someone dug in a lawn. The small garden fountains are not bordered: they
  // sit inside a place the kits
  // compose, and a paved ring through one is a hole in the axis it mirrors about.
  for (const court of sculpt.fountains) {
    if (court.size !== 'large') continue;
    placed += paveBand(
      place, pavable, surface, streets.materials.dominant,
      onGround(courtApron(court), court.tier), scope, COURT_REACH, COURT_ARC_MIN,
    );
  }

  // THE WALK'S OWN CROSSINGS FIRST. Stage B left the gap in the primary trunk and the sculptor
  // opened it; the deck is what makes the two banks one walk, and it is placed where the plan put
  // the gap rather than wherever a scan happens to find water.
  const rng = makeRng((seed ^ 0x3a11d) >>> 0);
  const decks = layLineDecks(place, streets, scope);
  const bridges = decks + layBridges(
    place, pavable, surface, rng, streets.materials.dominant,
    Math.round(lerp(BRIDGE_COUNT.min, BRIDGE_COUNT.max, richness)) - decks, refused, scope,
  );
  const crossings = { ramps: ramps.placed, bridges };
  placed += crossings.ramps + crossings.bridges;

  // The kits go in LAST, on the map as it finally stands: a region is composed on the ground the
  // terrain, the streets and the buildings actually left it, never on the lot it was planned as.
  const dressing = dressRegions({
    place, plan, anchors, seed, richness, material: streets.materials.dominant,
    ...(scope.bounded ? { within: (x: number, y: number) => scope.cell(x, y) } : {}),
    // A LARGE FOUNTAIN KEEPS A WHOLE COURT and a small one sits in a garden — the supplement's own
    // distinction, and the kits read it here: only the large court's ground is kept clear, so a
    // garden fountain is planted around like anything else standing in a place. Keeping the small
    // ones clear too punched a hole through the middle of the region each stood in, which is exactly
    // where a composed place's mirror axis runs.
    avoid: keepClear(sculpt, state.template.width, state.template.height),
  });
  placed += dressing.planted + dressing.paved;

  const W = state.template.width;
  const unroadedGates = anchors.placements
    .filter((p) => !place.roads.has(flatIndex(p.approach.x, p.approach.y, W)))
    .map((p) => ({ regionId: p.regionId, catalogId: p.catalogId }));

  return {
    plan, composition, line, streets, districts: districts.assignments, sculpt, anchors, placed, terrain,
    refused, crossings, rampsMisplaced: ramps.misplaced, lanesSkipped, unroadedGates, dressing,
  };
}

/** What each island kind does to the water the richness knob asked for. The kinds are named after
 *  this difference, so it is the whole of what they mean to the designed pipeline. */
const WATER_SCALE: Readonly<Record<'earth' | 'water' | 'mixed', number>> = {
  earth: 0, mixed: 1, water: 1.5,
};

/**
 * How far a course may run from a doorstep to the streets.
 *
 * Longer than a bridge bank's default, because a door and a street can stand a terrace apart: the
 * anti-grid stands the branch lines further out at the rich end, and a lot at the back of a block is
 * that much further from the one that serves it. The alternative is a doorstep paved as an island,
 * and `paveApproach` refuses that — a lone cell no walk reaches is a tip the connectivity ledger
 * counts and a door nobody can get to.
 */
const DOOR_REACH = 24;

/** How far a course may run to reach the figure's frame. Longer than a doorstep's, because the figure
 *  stands on the emptiest ground the island has and the nearest street is a terrace away. */
const FRAME_REACH = 24;
/** The shortest arc of the frame worth paving. Under two cells wide by its own depth there is no
 *  border to read, and a stub of pavement is a tip the connectivity ledger counts. */
const FRAME_ARC_MIN = 8;
/** The court's own border. Its reach is shorter than the figure's — a court is composed against a
 *  street it already stands within six cells of (`fountain.ts:ARRIVAL_REACH`), so a course that has to
 *  run further than a place is wide is reaching for a street the court was not composed against. The
 *  arc floor is one side of the smallest court's margin. */
const COURT_REACH = 14;
const COURT_ARC_MIN = 6;
const lerp = (a: number, b: number, v: number): number => a + (b - a) * (v < 0 ? 0 : v > 1 ? 1 : v);
