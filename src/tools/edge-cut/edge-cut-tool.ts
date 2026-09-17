import { CommandType, TerrainType, ToolType } from '../../core/model/types';
import type { Corners, CornerTrim, GridState, MacroCoord, MicroCoord, PlacedObject, TrimCornersCommand } from '../../core/model/types';
import type { Tool, ToolContext } from '../runtime/types';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { getCell } from '../../core/model/grid-model';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { cornerWrappedAt, highestNeighborTerrain, groundConvexCornerInWater } from '../../core/edge-cut/terrain-silhouette';
import { validateCut, isInnerCorner, OUTER_TRI, INNER_TRI } from '../../core/edge-cut/cut-validator';
import {
  CANONICAL_ROAD_STATES, CONN_SIDES, ROTATION_TO_CONN,
  canonicalToActual, cornersMatch, detectRoadConn, countRoadNeighbors,
} from '../../core/edge-cut/road-cut-states';
import type { RoadLookup } from '../../core/model/road-lookup';
import { roadLookup } from '../../state/object-index';

export interface TerrainSlot {
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

// A corner has 3 looks indexed 0=square/off, 1=fan, 2=tri. When ONE click governs several cut sites (a gamma
// + an outer cut, or a diagonal pinch sharing a macro-cell), they're the digits of a base-3 counter advanced
// by ONE per click — so the click traverses every combination (3^n), each site holding its own shape,
// instead of moving them in lockstep through just 3. (`siteDigit` reads a site's current digit; this maps a
// digit back to an OUTER corner's shape.)
function digitShape(d: number, cornerIdx: number): CornerTrim {
  return d === 1 ? 'fan' : d === 2 ? OUTER_TRI[cornerIdx]! : 'square';
}

/** A cut SITE gathered at a clicked intersection: a GAMMA fillet (carrying the wrapping mountain's
 *  type/elevation) or, with no `gamma`, a plain OUTER / ground-islet convex corner. Every site at one click
 *  shares ONE base-3 odometer (0=off, 1=fan, 2=tri) so N sites traverse all 3^N combinations independently. */
interface CutSite {
  slot: TerrainSlot;
  gamma?: { type: TerrainType; elev: number };
}

interface RoadCutResult {
  corners: Corners;
  rotation?: 0 | 90 | 180 | 270;
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
    const slots: RoadCutResult[] = [{ corners: ['square', 'square', 'square', 'square'], rotation: 0 }];
    for (const rot of [0, 90, 180, 270] as const) {
      for (let sIdx = 1; sIdx < CANONICAL_ROAD_STATES.length; sIdx++) {
        slots.push({ corners: [...CANONICAL_ROAD_STATES[sIdx]!], rotation: rot });
      }
    }
    const currentConn = ROTATION_TO_CONN[road.rotation] ?? 'left';
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
    const corners: Corners = canonical ? [...canonical] : ['square', 'square', 'square', 'square'];
    const actual = canonicalToActual(corners, conn);
    if (validateCut(state, roads, road.position.x, road.position.y, 'road', actual)) {
      return { corners };
    }
  }
  return null;
}

export class EdgeCutTool implements Tool {
  readonly id = ToolType.EdgeCut;
  readonly cursor: CursorId = 'edge-cut';

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const roads = roadLookup(ctx.gridState);
    const strokeStart = ctx.getUndoStackSize();
    let acted = false;
    const sites: CutSite[] = []; // every cut site meeting this click — gamma fillets AND outer/islet corners

    for (const slot of getTerrainSlots(coord.x, coord.y)) {
      const cell = getCell(ctx.gridState.cells, slot.cellX, slot.cellY);
      const cellTerr = cell?.terrain && cell.terrain.type !== TerrainType.None ? cell.terrain : null;
      const cellElev = cellTerr && !cellTerr.patchOnly ? cellTerr.elevation : -1;
      const hi = highestNeighborTerrain(ctx.gridState, slot.cellX, slot.cellY);
      // A notch-fill (branch A) materialises EMPTY ground or raises/cycles a SAME-type hidden block INTO
      // the wrapping structure's type. Two guards:
      //   - never overwrite a DIFFERENT real surface — a water cell tucked beside a taller mountain keeps
      //     its water and rounds its OWN outer corner via branch B; and
      //   - only a MOUNTAIN fills a notch this way. A WATER notch (a ground islet, or lower land, tucked
      //     into water) must NOT be flooded — the islet rounds out via the water's concave cut (branch B,
      //     a free notch corner), the water staying its inner fill.
      const cellIsDifferentReal = !!cellTerr && !cellTerr.patchOnly && !!hi && cellTerr.type !== hi.type;

      // (A) This corner is CONCAVE relative to a HIGHER MOUNTAIN → it's that taller structure's gamma
      //     corner. Round the higher tier with a COSMETIC fillet — an edge cut never paints a support
      //     column, so the fillet's real base (`patchBase`) is whatever the notch ALREADY was: a real
      //     lower block's tier, or 0 (empty). The fillet renders at the higher tier; structurally the
      //     notch is unchanged.

      // `isInnerCorner` carries the rest of the test — the notch, the pit, the wrap. The fillet
      // lands at the HIGHEST tier this corner is wrapped at, searched down from the tallest
      // neighbour: walls of unequal height wrap the corner only up to the shorter one, and asking
      // about the taller wall's tier alone refused the whole notch.
      if (hi && hi.type === TerrainType.Mountain && !cellIsDifferentReal && hi.elevation > cellElev) {
        let gammaTier = 0;
        for (let e = hi.elevation; e > cellElev && e >= 1; e--) {
          if (isInnerCorner(ctx.gridState, slot.cellX, slot.cellY, slot.cornerIdx, hi.type, e)) { gammaTier = e; break; }
        }
        if (gammaTier > 0) {
          sites.push({ slot, gamma: { type: hi.type, elev: gammaTier } });
          continue;
        }
      }

      // (B) An OUTER corner is cuttable — collect it; a single click may govern several (a diagonal pinch),
      //     so they're cycled JOINTLY after the loop to reach every combination. Two kinds:
      //   - a real mountain/water cell's convex corner (unless a same-tier neighbour pins it); or
      //   - a GROUND islet corner poking into water (the cut lives on the ground cell — see option A:
      //     the inverse of a water pond; rounds the islet's own corner, revealing the water).
      // A real block OR a gamma patch that has a REAL base (patchBase >= 1) can bevel an UNWRAPPED corner —
      // its outer cut is independent of any gamma fillet on the same cell. (Branch A already intercepted the
      // wrapped corner via `continue`, so anything reaching here is a plain outer corner.) A from-empty
      // cosmetic gamma (patchBase 0) has no base, so it offers no outer cut.
      const hasRealBase = cellTerr && (!cellTerr.patchOnly || (cellTerr.patchBase ?? 0) >= 1);
      if (hasRealBase) {
        const locked = computeLockedCorners(ctx.gridState, roads, slot.cellX, slot.cellY, 'terrain');
        if (!locked[slot.cornerIdx]) sites.push({ slot });
      } else if (!cellTerr && groundConvexCornerInWater(ctx.gridState, slot.cellX, slot.cellY, slot.cornerIdx)) {
        sites.push({ slot });
      }
    }

    // ONE base-3 odometer over every cut site at this click — gamma fillets AND outer cuts cycle together
    // (0=off, 1=fan, 2=tri), so N sites visit all 3^N combinations independently, never in lockstep.
    if (this.cycleSites(sites, ctx)) acted = true;

    const road = roads(coord.x, coord.y);
    if (road) {
      const next = nextValidRoadState(ctx.gridState, roads, road);
      if (next) {
        // Carry any rotation change on the command (rather than mutating road.rotation
        // directly) so undo/redo restores it; applyCommand applies afterRotation.
        ctx.executeCommand({
          type: CommandType.TrimCorners,
          timestamp: Date.now(),
          x: coord.x, y: coord.y, layer: 'road', objectId: road.id,
          beforeCorners: road.corners ? [...road.corners] as Corners : undefined,
          afterCorners: next.corners,
          ...(next.rotation !== undefined
            ? { beforeRotation: road.rotation, afterRotation: next.rotation }
            : {}),
        } as TrimCornersCommand);
        acted = true;
      }
    }

    if (acted) {
      // NO reconcile: an edge cut changes only the silhouette, never terrain support, so it can't invalidate
      // any cut — the neighbourhood repair pass (for terrain *paints*) has nothing to do here and must not
      // reach outside the edited corner. The tool already produced the final valid state above.
      ctx.commitStroke(strokeStart, { reconcile: false });
      // ATOMIC UNDO: one click = one undo step — a gamma raise (several paints + a trim) folds into one entry.
      ctx.collapseHistory(strokeStart);
    }
  }

  /**
   * Cycle every cut SITE gathered for one click as the digits of a base-3 counter (0=off, 1=fan, 2=tri),
   * advancing the WHOLE counter by one. With one site this is the plain off→fan→tri→off cycle; with several
   * (a gamma fillet + an outer cut, or a diagonal pinch sharing a macro-cell) a click steps through all 3^n
   * combinations so each site holds its own shape, never moving in lockstep. Returns true if anything changed.
   */
  private cycleSites(sites: CutSite[], ctx: ToolContext): boolean {
    if (sites.length === 0) return false;
    let idx = 0, place = 1;
    for (const s of sites) { idx += this.siteDigit(ctx, s) * place; place *= 3; } // place ends as 3^n
    idx = (idx + 1) % place; // ONE combined step per click → visits every combination over 3^n clicks
    let acted = false;
    for (const s of sites) {
      const digit = idx % 3;
      idx = Math.floor(idx / 3);
      if (s.gamma ? this.applyGamma(ctx, s, digit) : this.applyOuter(ctx, s.slot, digit)) acted = true;
    }
    return acted;
  }

  /** A site's current shape as a base-3 digit: 0 = off (square/empty), 1 = fan, 2 = tri (INNER for a gamma,
   *  OUTER otherwise). */
  private siteDigit(ctx: ToolContext, s: CutSite): number {
    const c = getCell(ctx.gridState.cells, s.slot.cellX, s.slot.cellY)?.terrain?.corners?.[s.slot.cornerIdx];
    if (c === 'fan') return 1;
    if (c === (s.gamma ? INNER_TRI : OUTER_TRI)[s.slot.cornerIdx]) return 2;
    return 0;
  }

  /** Apply a base-3 digit to an OUTER convex corner (0=square, 1=fan, 2=outer-tri). `terr` is null for a
   *  plain-ground islet corner; the executor materialises a `type: None` cell to carry the corners (and
   *  drops it back to ground when they cycle to all-square). */
  private applyOuter(ctx: ToolContext, slot: TerrainSlot, digit: number): boolean {
    const want = digitShape(digit, slot.cornerIdx);
    const terr = getCell(ctx.gridState.cells, slot.cellX, slot.cellY)?.terrain;
    const before: Corners = terr?.corners ? [...terr.corners] : ['square', 'square', 'square', 'square'];
    if (before[slot.cornerIdx] === want) return false;
    const after: Corners = [...before];
    after[slot.cornerIdx] = want;
    ctx.executeCommand({
      type: CommandType.TrimCorners, timestamp: Date.now(), x: slot.cellX, y: slot.cellY, layer: 'terrain',
      beforeCorners: before.every(c => c === 'square') ? undefined : before, afterCorners: after,
    } as TrimCornersCommand);
    return true;
  }

  /** Apply a base-3 digit to a GAMMA fillet (0=off, 1=fan, 2=inner-tri). A Γ cut only ever ADDS a cosmetic
   *  fillet at the wrapped corner — never changing the cell's real support. Materialises the patch on first
   *  cut; cycling the last fillet OFF drops back to the real base (keeping any unwrapped outer bevel) or,
   *  with no base, to bare ground. */
  private applyGamma(ctx: ToolContext, s: CutSite, digit: number): boolean {
    const { slot } = s;
    const idx = slot.cornerIdx;
    const shape: CornerTrim = digit === 1 ? 'fan' : digit === 2 ? INNER_TRI[idx]! : 'empty';
    const cell = getCell(ctx.gridState.cells, slot.cellX, slot.cellY);
    const cellTerr = cell?.terrain && cell.terrain.type !== TerrainType.None ? cell.terrain : null;
    if (cellTerr?.patchOnly) {
      const currentCorners: Corners = cellTerr.corners ? [...cellTerr.corners] : ['empty', 'empty', 'empty', 'empty'];
      if (currentCorners[idx] === shape) return false;
      const afterCorners: Corners = [...currentCorners];
      afterCorners[idx] = shape;
      const base = cellTerr.patchBase ?? (cellTerr.elevation - 1);
      // a WRAPPED corner still holding a fillet keeps this a patch; otherwise drop to the real base (keeping
      // any unwrapped outer bevel), or — with no base — clear back to bare ground.
      const keepsFillet = afterCorners.some((c, i) => c !== 'empty' && c !== 'square'
        && cornerWrappedAt(ctx.gridState, slot.cellX, slot.cellY, i, cellTerr.type, cellTerr.elevation));
      if (!keepsFillet && base >= 1) {
        ctx.executeCommand({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells: [{ x: slot.cellX, y: slot.cellY }], terrainType: cellTerr.type, elevation: base });
        const kept: Corners = afterCorners.map((c) => (c === 'empty' ? 'square' : c)) as Corners;
        if (kept.some((c) => c !== 'square')) {
          ctx.executeCommand({ type: CommandType.TrimCorners, timestamp: Date.now(), x: slot.cellX, y: slot.cellY, layer: 'terrain', beforeCorners: ['square', 'square', 'square', 'square'], afterCorners: kept } as TrimCornersCommand);
        }
      } else {
        ctx.executeCommand({ type: CommandType.TrimCorners, timestamp: Date.now(), x: slot.cellX, y: slot.cellY, layer: 'terrain', beforeCorners: currentCorners, afterCorners } as TrimCornersCommand);
      }
      return true;
    }
    if (shape === 'empty') return false; // off and not yet a patch → nothing to do
    // MATERIALISE the cosmetic gamma. patchBase = the notch's existing block tier, or 0 when empty. The fillet
    // adds ONLY its corner: a real block keeps its outer cuts (square = full base), an empty notch starts empty.
    const patchBase = cellTerr ? cellTerr.elevation : 0;
    const afterCorners: Corners = cellTerr?.corners ? [...cellTerr.corners]
      : (cellTerr ? ['square', 'square', 'square', 'square'] : ['empty', 'empty', 'empty', 'empty']);
    afterCorners[idx] = shape;
    ctx.executeCommand({ type: CommandType.TrimCorners, timestamp: Date.now(), x: slot.cellX, y: slot.cellY, layer: 'terrain', beforeCorners: undefined, afterCorners, patchOnly: true, terrainType: s.gamma!.type, elevation: s.gamma!.elev, patchBase } as TrimCornersCommand);
    return true;
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const roads = roadLookup(ctx.gridState);
    let hasAny = false;
    for (const slot of getTerrainSlots(coord.x, coord.y)) {
      const cell = getCell(ctx.gridState.cells, slot.cellX, slot.cellY);
      if (cell?.terrain && cell.terrain.type !== TerrainType.None && !cell.terrain.patchOnly) {
        hasAny = true; break;
      }
      const ref = highestNeighborTerrain(ctx.gridState, slot.cellX, slot.cellY);
      if (ref && isInnerCorner(ctx.gridState, slot.cellX, slot.cellY, slot.cornerIdx, ref.type, ref.elevation)) {
        hasAny = true; break;
      }
      if (groundConvexCornerInWater(ctx.gridState, slot.cellX, slot.cellY, slot.cornerIdx)) {
        hasAny = true; break; // a ground islet corner poking into water is cuttable
      }
    }
    if (!hasAny) {
      hasAny = roads(coord.x, coord.y) !== null;
    }
    ctx.overlay.showGhost([coord], { icon: 'trim', valid: hasAny }, false);
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, _ctx: ToolContext): void {}
  onActivate(_ctx: ToolContext): void {}
  onDeactivate(ctx: ToolContext): void {
    ctx.overlay.clearGhost();
  }
}
