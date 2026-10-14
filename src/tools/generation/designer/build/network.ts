/**
 * Lays the walkable network a design planned, after its terrain: the streets, the hub's apron, the
 * street flights, the anchor buildings and the courses joining their doors, the court lanes, the
 * paved frames round the set piece and the large fountain courts, and the bridges.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { makeRng } from '../../../../core/base/rng';
import { lerpClamped } from '../../../../core/base/math';
import type { MacroCoord, PlacedObject, Rotation } from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import { getRotatedSize } from '../../../../core/grid/footprint';
import { tryPlace, type PlaceCtx } from '../../../placement/object';
import type { AnchorPlan } from '../places/anchors';
import type { StreetPlan } from '../streets/model';
import { frameCells } from '../terrain/landmark';
import type { TerrainSculpt } from '../terrain/terrain-sculpt';
import { BRIDGE_COUNT, layBridges, layFlights, layLineDecks } from './crossings';
import { mouthPaved, paveApproach, paveBand, paveHubApron, type Paving } from './paving';
import type { Scope } from './scope';

/** The plans the network is laid from. */
export interface NetworkDesign {
  streets: StreetPlan;
  anchors: AnchorPlan;
  sculpt: TerrainSculpt;
  seed: number;
  richness: number;
}

/** The map readings every course is judged on: where pavement may go and each cell's walking level. */
export interface NetworkGround {
  pavable: Uint8Array;
  surface: Int8Array;
}

export interface NetworkOutcome {
  /** Objects the map accepted: road tiles, buildings, court-lane tiles and crossings together. */
  placed: number;
  /** Placements the rules refused, by kind (`DesignedOutcome.refused`). */
  refused: { roads: number; anchors: number; lanes: number; crossings: number };
  crossings: { ramps: number; bridges: number };
  rampsMisplaced: number;
  lanesSkipped: string[];
  /** The anchor buildings that landed, in plan order. */
  buildings: PlacedObject[];
}

export function buildNetwork(
  place: PlaceCtx, design: NetworkDesign, ground: NetworkGround, scope: Scope,
): NetworkOutcome {
  const { state } = place;
  const { streets, anchors, sculpt, seed, richness } = design;
  const { pavable, surface } = ground;
  const paving: Paving = { place, pavable, surface, material: streets.materials.dominant, scope };
  const refused = { roads: 0, anchors: 0, lanes: 0, crossings: 0 };
  let placed = 0;

  // Roads first, exactly as the plan lays them out: the network is what every place is reached by,
  // and a building placed onto pavement is a placement `tryPlace` would refuse anyway.
  for (const cell of streets.cells) {
    if (!scope.cell(cell.x, cell.y)) continue;
    if (tryPlace(place, cell.material, cell.x, cell.y)) placed++;
    else refused.roads++;
  }

  // The plaza is the hub, so the network reaches it even where stage B could lay no street along its
  // ring: a short 2-wide course from the plaza's own edge out to the nearest pavement. It costs
  // nothing on a map whose trunks already run against the plaza, which is nearly every one.
  placed += paveHubApron(paving);

  // The ramps are the streets' own, and the only ones on the map, so none is ever overused or left
  // standing on a road. Each one is placed by its anchor, because the `heightDrop`
  // trait resolves position and rotation from the cliff it finds — so what the plan drew is checked
  // against what the engine stored rather than assumed.
  const ramps = layFlights(place, streets, scope);

  // The buildings. `tryPlace` reserves and sweeps each house's gate strip as it lands, so the next
  // one in the same court cannot be dropped across its neighbour's doorstep.
  const buildings: PlacedObject[] = [];
  for (const p of anchors.placements) {
    const foot = footprintOf(p.catalogId, p.position.x, p.position.y, p.rotation);
    if (!scope.rect(foot.x, foot.y, foot.w, foot.h)) continue;
    const building = tryPlace(place, p.catalogId, p.position.x, p.position.y, p.rotation);
    if (building) { placed++; buildings.push(building); }
    else refused.anchors++;
  }

  // Every door opens on a road, and the lot's own frontage is what usually provides it. Where stage
  // C could only fit a lot without a paved edge, the doorstep is joined to the network here: a
  // 2-wide course along the doorstep's own terrace, so the way to the door is a street rather than a
  // path one cell wide.
  for (const p of anchors.placements) {
    if (place.roads.has(flatIndex(p.approach.x, p.approach.y, state.template.width))) continue;
    placed += paveApproach(paving, p.approach, DOOR_REACH);
  }

  // The court lanes: they run between buildings that are now down, and a lane is only laid where
  // its mouth actually meets the frontage the road plan reached the lot with.
  const lanesSkipped: string[] = [];
  for (const lane of anchors.lanes) {
    // A lane joins the network at its mouth or it is a paved pocket. Where the lot's frontage did
    // not reach the mouth, the same course a doorstep takes is run out to the streets first.
    if (!mouthPaved(place.roads, state, lane)) {
      for (const c of lane.mouth) {
        placed += paveApproach(paving, c);
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

  // The figure is framed in pavement, and the course that reaches it is the walk arriving at the map's
  // one set piece. A banner is framed on four sides with a road border, which is the whole
  // difference between a signboard and a lake; and because the figure stands on a
  // high terrace, its frame is also the pavement that puts the walk above the ground floor.
  //
  // It is paved only where it can join the network. A ring nothing reaches is a paved pocket, which the
  // hard ledger reads as unreachable pavement and a visitor reads as scenery; where no course gets
  // there the frame stays the open terrace it was reserved as, which frames the figure just as well.
  // One connected piece of it, never the whole band: a frame cell the terrain or a lot took cuts the
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
      paving, onGround(frameCells(figure, W0, state.template.height), figure.tier),
      { reach: FRAME_REACH, arcMin: FRAME_ARC_MIN },
    );
  }

  // And the same border round every large fountain court. A large fountain is composed with a whole
  // court around it, and a court is a built space: water in the middle, a figure standing in the water,
  // and pavement round the whole of it. Left as the bare terrace it is reserved as, the composition reads
  // on a finished map as a pond someone dug in a lawn. The small garden fountains are not bordered: they
  // sit inside a place the kits
  // compose, and a paved ring through one is a hole in the axis it mirrors about.
  for (const court of sculpt.fountains) {
    if (court.size !== 'large') continue;
    placed += paveBand(paving, onGround(courtApron(court), court.tier), { reach: COURT_REACH, arcMin: COURT_ARC_MIN });
  }

  // The walk's own crossings first. Stage B left the gap in the primary trunk and the sculptor
  // opened it; the deck is what makes the two banks one walk, and it is placed where the plan put
  // the gap rather than wherever a scan happens to find water.
  const rng = makeRng((seed ^ 0x3a11d) >>> 0);
  const decks = layLineDecks(place, streets, scope);
  const bridges = decks + layBridges(paving, {
    rng, budget: Math.round(lerpClamped(BRIDGE_COUNT.min, BRIDGE_COUNT.max, richness)) - decks, refused,
  });
  const crossings = { ramps: ramps.placed, bridges };
  placed += crossings.ramps + crossings.bridges;

  return { placed, refused, crossings, rampsMisplaced: ramps.misplaced, lanesSkipped, buildings };
}

/**
 * The court is paved on the side the walk arrives from, never all the way round.
 *
 * A court stands at a street's end or off its flank, never astride it. The court's own ground is
 * reserved before a street is laid, so no street can cross it — but a border paved as a full ring is a
 * Loop, and the network then routes through it. So the apron is the half of the margin on
 * the arrival's side of the court's centre, which is a forecourt rather than a roundabout.
 */
function courtApron(court: { frame: MacroCoord[]; centre: MacroCoord; arrival: MacroCoord }): MacroCoord[] {
  const ux = court.arrival.x - court.centre.x, uy = court.arrival.y - court.centre.y;
  if (ux === 0 && uy === 0) return court.frame;
  return court.frame.filter((c) => (c.x - court.centre.x) * ux + (c.y - court.centre.y) * uy > 0);
}

/** The cells an object of `catalogId` would cover if placed at (x, y) with `rotation`. */
function footprintOf(catalogId: string, x: number, y: number, rotation: Rotation): Rect {
  const item = getCatalogItem(catalogId);
  if (!item) return { x, y, w: 1, h: 1 };
  const size = getRotatedSize(item, rotation);
  return { x, y, w: size.w, h: size.h };
}

/**
 * How far a course may run from a doorstep to the streets.
 *
 * Longer than a bridge bank's default, because a door and a street can stand a terrace apart: the
 * anti-grid stands the branch lines further out at the rich end, and a lot at the back of a block is
 * that much further from the one that serves it. The alternative is a doorstep paved as an isolated patch,
 * and `paveApproach` refuses that — a lone cell no walk reaches is a tip the connectivity ledger
 * counts and a door nobody can get to.
 */
const DOOR_REACH = 24;

/** How far a course may run to reach the figure's frame. Longer than a doorstep's, because the figure
 *  stands on the emptiest ground the planet has and the nearest street is a terrace away. */
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
