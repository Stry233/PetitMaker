import { paintTerrainCommand, materialisePatchCommand, trimRoadCommand, trimTerrainCommand } from '../../../core/model/command-build';
import { TerrainType, type Rotation, ROTATIONS } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import type { Corners, CornerTrim, GridState, PlacedObject } from '../../../core/model/types';
import type { Tool, ToolHost } from '../runtime/types';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { getCell } from '../../../core/model/grid-model';
import { cornerWrappedAt, highestNeighborTerrain, groundConvexCornerInWater } from '../../../core/domain/edge-cut/silhouette';
import { gammaTier, outerCutSites } from '../../../core/domain/edge-cut/cut-sites';
import { patchSupport } from '../../../core/domain/terrain/terrain-surface';
import { validateCut, isInnerCorner, OUTER_TRI, INNER_TRI } from '../../../core/domain/edge-cut/cut-validator';
import {
  CANONICAL_ROAD_STATES, CONN_SIDES, ROTATION_TO_CONN,
  canonicalToActual, cornersMatch, detectRoadConn, countRoadNeighbors,
} from '../../../core/domain/edge-cut/road-cut-states';
import type { RoadLookup } from '../../../core/model/road-lookup';
import { roadLookup } from '../../../state/object-index';
import { SQUARE_CORNERS, EMPTY_CORNERS, mapCorners } from '../../../core/model/corners';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { GridCell, MapPoint } from '../../../core/grid/grids';
import { cellSet } from '../../../core/grid/grids';
import type { Stroke } from '../../../core/commands/command-executor';

interface TerrainSlot {
  kind: 'terrain';
  cellX: number;
  cellY: number;
  cornerIdx: number;
}

function getTerrainSlots(mx: number, my: number): TerrainSlot[] {
  return [
    { kind: 'terrain', cellX: mx, cellY: my, cornerIdx: 3 },
    { kind: 'terrain', cellX: mx + 1, cellY: my, cornerIdx: 2 },
    { kind: 'terrain', cellX: mx, cellY: my + 1, cornerIdx: 1 },
    { kind: 'terrain', cellX: mx + 1, cellY: my + 1, cornerIdx: 0 },
  ];
}

// A corner has 3 looks indexed 0=square/off, 1=fan, 2=tri. When one click governs several cut sites (a gamma
// + an outer cut, or a diagonal pinch sharing a macro-cell), they're the digits of a base-3 counter advanced
// by one per click — so the click traverses every combination (3^n), each site holding its own shape,
// instead of moving them in lockstep through just 3. (`siteDigit` reads a site's current digit; this maps a
// digit back to an outer corner's shape.)
function digitShape(d: number, cornerIdx: number): CornerTrim {
  return d === 1 ? 'fan' : d === 2 ? OUTER_TRI[cornerIdx]! : 'square';
}

/** A cut site gathered at a clicked intersection: a gamma fillet (carrying the wrapping mountain's
 *  type/elevation) or, with no `gamma`, a plain outer / ground-islet convex corner. Every site at one click
 *  shares one base-3 odometer (0=off, 1=fan, 2=tri) so N sites traverse all 3^N combinations independently. */
interface CutSite {
  slot: TerrainSlot;
  gamma?: { type: TerrainType; elev: number };
}

interface RoadCutResult {
  corners: Corners;
  rotation?: Rotation;
}

function nextValidRoadState(state: GridState, roads: RoadLookup, road: PlacedObject): RoadCutResult | null {
  const isIsolated = countRoadNeighbors(roads, road) === 0;
  const conn = detectRoadConn(roads, road);

  if (isIsolated) {
    // Isolated: cycle raw, then every cut state × every direction — as an explicit
    // slot table derived from the state list, so the cycle order is readable and
    // cannot drift from CANONICAL_ROAD_STATES. An isolated road has zero road
    // neighbours, so the seam-contact validation is vacuous here: every slot is
    // legal by construction, which is why validateCut is not consulted.
    const slots: RoadCutResult[] = [{ corners: [...SQUARE_CORNERS], rotation: 0 }];
    for (const rot of ROTATIONS) {
      for (let sIdx = 1; sIdx < CANONICAL_ROAD_STATES.length; sIdx++) {
        slots.push({ corners: [...CANONICAL_ROAD_STATES[sIdx]!], rotation: rot });
      }
    }
    const currentConn = ROTATION_TO_CONN[road.rotation] ?? 'W';
    const connIdx = CONN_SIDES.indexOf(currentConn);
    let stateIdx = 0;
    for (let i = 0; i < CANONICAL_ROAD_STATES.length; i++) {
      if (cornersMatch(road.corners, CANONICAL_ROAD_STATES[i])) { stateIdx = i; break; }
    }
    const currentSlot = stateIdx === 0 ? 0 : 1 + connIdx * (CANONICAL_ROAD_STATES.length - 1) + (stateIdx - 1);
    return slots[(currentSlot + 1) % slots.length] ?? null;
  }

  // Connected roads: cycle through canonical states for the detected direction
  let currentIdx = 0;
  for (let i = 0; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(road.corners, CANONICAL_ROAD_STATES[i])) { currentIdx = i; break; }
  }
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    const nextIdx = (currentIdx + i) % CANONICAL_ROAD_STATES.length;
    const canonical = CANONICAL_ROAD_STATES[nextIdx];
    const corners: Corners = canonical ? [...canonical] : [...SQUARE_CORNERS];
    const actual = canonicalToActual(corners, conn);
    if (validateCut(state, roads, { x: road.position.x, y: road.position.y }, 'road', actual)) {
      return { corners };
    }
  }
  return null;
}

export class EdgeCutTool implements Tool<typeof PLACEMENT_GRID> {
  readonly id = ToolType.EdgeCut;
  grid(): typeof PLACEMENT_GRID { return PLACEMENT_GRID; }
  cursor(): CursorId { return 'edge-cut'; }

  /** The stroke of the press in progress: a press commits on the way down, so a cancelled one (a
   *  second finger landing, the browser taking the pointer) rolls it back. */
  private press: Stroke | null = null;

  onPointerDown(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: ToolHost): void {
    const stroke = ctx.beginStroke();
    this.press = stroke;
    const roads = roadLookup(ctx.state);
    let acted = false;
    const sites: CutSite[] = []; // every cut site meeting this click — gamma fillets and outer/islet corners

    for (const slot of getTerrainSlots(coord.x, coord.y)) {
      const cell = getCell(ctx.state.cells, slot.cellX, slot.cellY);
      const cellTerr = cell?.terrain && cell.terrain.type !== TerrainType.None ? cell.terrain : null;
      const cellElev = cellTerr && !cellTerr.patchOnly ? cellTerr.elevation : -1;
      const hi = highestNeighborTerrain(ctx.state, slot.cellX, slot.cellY);
      // A different real surface is never overwritten: a water cell beside a taller mountain keeps its
      // water and rounds its own outer corner (B).
      const cellIsDifferentReal = !!cellTerr && !cellTerr.patchOnly && !!hi && cellTerr.type !== hi.type;

      // (A) A corner concave to a higher mountain is that mountain's gamma corner: a cosmetic fillet at
      //     the highest tier wrapping it (`gammaTier`), over a base (`patchBase`) that stays what the
      //     notch was. Only a mountain fills a notch; a ground islet in water rounds out through (B).
      if (hi && hi.type === TerrainType.Mountain && !cellIsDifferentReal && hi.elevation > cellElev) {
        const tier = gammaTier(ctx.state, slot.cellX, slot.cellY, slot.cornerIdx, { type: hi.type, top: hi.elevation, floor: cellElev });
        if (tier > 0) {
          sites.push({ slot, gamma: { type: hi.type, elev: tier } });
          continue;
        }
      }

      // (B) A cuttable outer corner (`outerCutSites`); one click may meet several (a diagonal pinch),
      //     which cycle jointly after the loop.
      if (outerCutSites(ctx.state, roads, slot.cellX, slot.cellY)(slot.cornerIdx)) sites.push({ slot });
    }

    // One base-3 odometer over every cut site at this click — gamma fillets and outer cuts cycle together
    // (0=off, 1=fan, 2=tri), so N sites visit all 3^N combinations independently, never in lockstep.
    if (this.cycleSites(sites, ctx)) acted = true;

    const road = roads(coord.x, coord.y);
    if (road) {
      const next = nextValidRoadState(ctx.state, roads, road);
      if (next) {
        // The rotation change rides on the command, so the history entry records the road turned.
        ctx.execute(trimRoadCommand(road, coord.x, coord.y, next.corners, next.rotation));
        acted = true;
      }
    }

    if (acted) {
      // No reconcile: an edge cut changes only the silhouette, never terrain support, so it can't invalidate
      // any cut — the neighbourhood repair pass (for terrain *paints*) has nothing to do here and must not
      // reach outside the edited corner. The tool already produced the final valid state above.
      stroke.commit({ reconcile: false });
      // Atomic undo: one click = one undo step — a gamma raise (several paints + a trim) folds into one entry.
      stroke.collapse();
    }
  }

  /**
   * Cycle every cut site gathered for one click as the digits of a base-3 counter (0=off, 1=fan, 2=tri),
   * advancing the whole counter by one. With one site this is the plain off→fan→tri→off cycle; with several
   * (a gamma fillet + an outer cut, or a diagonal pinch sharing a macro-cell) a click steps through all 3^n
   * combinations so each site holds its own shape, never moving in lockstep. Returns true if anything changed.
   */
  private cycleSites(sites: CutSite[], ctx: ToolHost): boolean {
    if (sites.length === 0) return false;
    let idx = 0, place = 1;
    for (const s of sites) { idx += this.siteDigit(ctx, s) * place; place *= 3; } // place ends as 3^n
    idx = (idx + 1) % place; // One combined step per click → visits every combination over 3^n clicks
    let acted = false;
    for (const s of sites) {
      const digit = idx % 3;
      idx = Math.floor(idx / 3);
      if (s.gamma ? this.applyGamma(ctx, s, digit) : this.applyOuter(ctx, s.slot, digit)) acted = true;
    }
    return acted;
  }

  /** A site's current shape as a base-3 digit: 0 = off (square/empty), 1 = fan, 2 = tri (inner for a gamma,
   *  outer otherwise). */
  private siteDigit(ctx: ToolHost, s: CutSite): number {
    const c = getCell(ctx.state.cells, s.slot.cellX, s.slot.cellY)?.terrain?.corners?.[s.slot.cornerIdx];
    if (c === 'fan') return 1;
    if (c === (s.gamma ? INNER_TRI : OUTER_TRI)[s.slot.cornerIdx]) return 2;
    return 0;
  }

  /** Apply a base-3 digit to an outer convex corner (0=square, 1=fan, 2=outer-tri). `terr` is null for a
   *  plain-ground islet corner; the executor materialises a `type: None` cell to carry the corners (and
   *  drops it back to ground when they cycle to all-square). */
  private applyOuter(ctx: ToolHost, slot: TerrainSlot, digit: number): boolean {
    const want = digitShape(digit, slot.cornerIdx);
    const terr = getCell(ctx.state.cells, slot.cellX, slot.cellY)?.terrain;
    const before: Corners = terr?.corners ? [...terr.corners] : [...SQUARE_CORNERS];
    if (before[slot.cornerIdx] === want) return false;
    const after: Corners = [...before];
    after[slot.cornerIdx] = want;
    ctx.execute(trimTerrainCommand(slot.cellX, slot.cellY, after));
    return true;
  }

  /** Apply a base-3 digit to a gamma fillet (0=off, 1=fan, 2=inner-tri). A Γ cut only ever adds a cosmetic
   *  fillet at the wrapped corner — never changing the cell's real support. Materialises the patch on first
   *  cut; cycling the last fillet off drops back to the real base (keeping any unwrapped outer bevel) or,
   *  with no base, to bare ground. */
  private applyGamma(ctx: ToolHost, s: CutSite, digit: number): boolean {
    const { slot } = s;
    const idx = slot.cornerIdx;
    const shape: CornerTrim = digit === 1 ? 'fan' : digit === 2 ? INNER_TRI[idx]! : 'empty';
    const cell = getCell(ctx.state.cells, slot.cellX, slot.cellY);
    const cellTerr = cell?.terrain && cell.terrain.type !== TerrainType.None ? cell.terrain : null;
    if (cellTerr?.patchOnly) {
      const currentCorners: Corners = cellTerr.corners ? [...cellTerr.corners] : [...EMPTY_CORNERS];
      if (currentCorners[idx] === shape) return false;
      const afterCorners: Corners = [...currentCorners];
      afterCorners[idx] = shape;
      const base = patchSupport(cellTerr);
      // a wrapped corner still holding a fillet keeps this a patch; otherwise drop to the real base (keeping
      // any unwrapped outer bevel), or — with no base — clear back to bare ground.
      const keepsFillet = afterCorners.some((c, i) => c !== 'empty' && c !== 'square'
        && cornerWrappedAt(ctx.state, slot.cellX, slot.cellY, i, cellTerr));
      if (!keepsFillet && base >= 1) {
        ctx.execute(paintTerrainCommand([{ x: slot.cellX, y: slot.cellY }], cellTerr.type, base));
        const kept: Corners = mapCorners(afterCorners, (c) => (c === 'empty' ? 'square' : c));
        if (kept.some((c) => c !== 'square')) {
          ctx.execute(trimTerrainCommand(slot.cellX, slot.cellY, kept));
        }
      } else {
        ctx.execute(trimTerrainCommand(slot.cellX, slot.cellY, afterCorners));
      }
      return true;
    }
    if (shape === 'empty') return false; // off and not yet a patch → nothing to do
    // Materialise the cosmetic gamma. patchBase = the notch's existing block tier, or 0 when empty. The fillet
    // adds only its corner: a real block keeps its outer cuts (square = full base), an empty notch starts empty.
    const patchBase = cellTerr ? cellTerr.elevation : 0;
    const afterCorners: Corners = cellTerr?.corners ? [...cellTerr.corners]
      : (cellTerr ? [...SQUARE_CORNERS] : [...EMPTY_CORNERS]);
    afterCorners[idx] = shape;
    ctx.execute(materialisePatchCommand(slot.cellX, slot.cellY, afterCorners, { terrainType: s.gamma!.type, elevation: s.gamma!.elev, patchBase }));
    return true;
  }

  onPointerMove(coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: ToolHost): void {
    const roads = roadLookup(ctx.state);
    let hasAny = false;
    for (const slot of getTerrainSlots(coord.x, coord.y)) {
      const cell = getCell(ctx.state.cells, slot.cellX, slot.cellY);
      if (cell?.terrain && cell.terrain.type !== TerrainType.None && !cell.terrain.patchOnly) {
        hasAny = true; break;
      }
      const ref = highestNeighborTerrain(ctx.state, slot.cellX, slot.cellY);
      if (ref && isInnerCorner(ctx.state, slot.cellX, slot.cellY, slot.cornerIdx, ref)) {
        hasAny = true; break;
      }
      if (groundConvexCornerInWater(ctx.state, slot.cellX, slot.cellY, slot.cornerIdx)) {
        hasAny = true; break; // a ground islet corner poking into water is cuttable
      }
    }
    if (!hasAny) {
      hasAny = roads(coord.x, coord.y) !== null;
    }
    ctx.overlay.showGhost(cellSet(this.grid(), [coord]), { icon: 'trim', valid: hasAny });
  }

  onPointerUp(_coord: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, _ctx: ToolHost): void {
    this.press = null;
  }

  /** The press never happened: what it committed is taken back without a redo step. */
  onPointerCancel(_ctx: ToolHost): void {
    this.press?.rollback();
    this.press = null;
  }
  onActivate(_ctx: ToolHost): void {}
  onDeactivate(ctx: ToolHost): void {
    ctx.overlay.clearGhost();
  }
}
