/*
 * bridge-span.ts — shared bridge span detection for the placement rule
 * (V-PLACE-TRAIT waterSpan) and the placement ghost (object-placer).
 *
 * Policy: a bridge is an overpass between two flat ends of EQUAL height, across
 * a gap of any length within [min, max]. The gap below the deck may be water,
 * off-map void, OR lower terrain (a valley/ravine) — water is not
 * required. Detection works on an "effective level" where water and off-map
 * read as below everything, so the two raised, flat, equal-height ends are
 * found by scanning out from the clicked gap cell.
 *
 * THE HALF GRID (the halfStep trait): the anchor may sit on a half cell in
 * either axis, so everything here walks in half-macro steps and keeps its
 * arithmetic in micro units (1 macro = 2 micro). A probe on a half coordinate
 * straddles two macro cells and reads the MIN of them: a deck is supported only
 * where every straddled cell holds the level, and any straddled gap makes the
 * whole probe a gap — a deck end cannot rest half on rock and half on water.
 *
 * That min read also fixes the span's granularity: a half probe can only read
 * raised when the whole cell nearer the anchor already did, and the walk would
 * have stopped there, so both ends always land on WHOLE coordinates. The span
 * length therefore stays whole, and only the axis ACROSS the deck — which the
 * anchor supplies directly — can carry a half offset.
 */
import { TerrainType } from './types';
import type { GridState, MacroCoord } from './types';
import { getCell, onHalfGrid, straddledCells } from './grid-model';
import { realSurface } from '../edge-cut/terrain-silhouette';

export interface BridgeSpan {
  rotation: 0 | 90;
  position: MacroCoord;  // top-left of the footprint (rests on the near end)
  spanLength: number;    // footprint length along the span axis
  elevation: number;     // deck height (the two ends' shared elevation)
  cells: MacroCoord[];   // full footprint (for the ghost preview)
}

const DIRS = [
  { dx: 1, dy: 0, px: 0, py: 1, rot: 0 as const },
  { dx: 0, dy: 1, px: 1, py: 0, rot: 90 as const },
];

/** Height a bridge sees a single cell at: water and off-map read as -1 (a
 *  spannable gap, below any real ground), bare ground as 0, mountains as their
 *  elevation. */
function cellLevel(state: GridState, x: number, y: number): number {
  const cell = getCell(state.cells, x, y);
  if (!cell) return -1;                                   // off-map / void
  const surf = realSurface(cell.terrain);                 // Γ fillets read as their base (kernel semantics)
  if (!surf) return 0;                                    // bare ground
  if (surf.type === TerrainType.Water) return -1;         // water
  return surf.elevation;
}

/** Min-support read of `cellLevel` over every macro cell (x, y) straddles. */
function effLevel(state: GridState, x: number, y: number): number {
  const xs = straddledCells(x), ys = straddledCells(y);
  let level = Infinity;
  for (let cy = ys.lo; cy <= ys.hi; cy++)
    for (let cx = xs.lo; cx <= xs.hi; cx++)
      level = Math.min(level, cellLevel(state, cx, cy));
  return level;
}

/** True iff every micro-block across the bridge's perpendicular width satisfies `test`.
 *  The width walks micro columns and resolves each to the terrain cell holding it
 *  (terrain renders at −HALF_TILE, hence the ceil); the span coordinate passes through
 *  as it is, so a half one is read as the straddle it names. */
function fullWidth(
  state: GridState, x: number, y: number,
  perpDx: number, perpDy: number, width: number,
  test: (level: number) => boolean,
): boolean {
  const mx = Math.round(x * 2), my = Math.round(y * 2);
  for (let m = 0; m < width * 2; m++) {
    const cx = perpDx ? Math.ceil((mx + perpDx * m) / 2) : x;
    const cy = perpDy ? Math.ceil((my + perpDy * m) / 2) : y;
    if (!test(effLevel(state, cx, cy))) return false;
  }
  return true;
}

/**
 * Detect a legal bridge span anchored at `anchor` (a clicked gap cell, whole or
 * half). Returns the snapped placement, or null if no valid span exists in
 * either orientation.
 */
export function detectBridgeSpan(
  state: GridState, anchor: MacroCoord, width: number, min: number, max: number,
): BridgeSpan | null {
  if (!onHalfGrid(anchor.x) || !onHalfGrid(anchor.y)) return null;

  for (const dir of DIRS) {
    const along0 = dir.dx ? anchor.x : anchor.y;
    // The deck's first micro column resolves the ACROSS coordinate to one real cell,
    // so the centre line the walk follows is a row of the deck rather than the
    // boundary between two of them; fullWidth keeps the raw coordinate instead,
    // since it walks the deck's own micro columns.
    const acrossLine = Math.ceil(dir.dx ? anchor.y : anchor.x);
    const acrossRaw = dir.dx ? anchor.y : anchor.x;
    const levelAt = (a: number): number =>
      dir.dx ? effLevel(state, a, acrossLine) : effLevel(state, acrossLine, a);
    const widthAt = (a: number, test: (level: number) => boolean): boolean =>
      dir.dx ? fullWidth(state, a, acrossRaw, dir.px, dir.py, width, test)
             : fullWidth(state, acrossRaw, a, dir.px, dir.py, width, test);

    const anchorLvl = levelAt(along0);

    // Walk the centre line out to the first raised cell on each side — the ends.
    // Steps are half-macro, counted whole so the arithmetic stays integral.
    let negSteps = -1, posSteps = -1, eN = -1, eP = -1;
    for (let s = 1; s <= (max + 2) * 2; s++) {
      const lvl = levelAt(along0 - s / 2);
      if (lvl > anchorLvl) { negSteps = s; eN = lvl; break; }
    }
    for (let s = 1; s <= (max + 2) * 2; s++) {
      const lvl = levelAt(along0 + s / 2);
      if (lvl > anchorLvl) { posSteps = s; eP = lvl; break; }
    }
    if (negSteps < 0 || posSteps < 0) continue;  // no raised end on one side
    if (eN !== eP) continue;                     // ends must be the same height
    const deckE = eN;
    const gapCount = (negSteps + posSteps) / 2 - 1;  // cells spanned (incl. the anchor)
    if (gapCount < min || gapCount > max) continue;

    // Full-width checks: both ends flat at the deck height, every gap cell below it.
    const atDeck = (lvl: number) => lvl === deckE;
    const belowDeck = (lvl: number) => lvl < deckE;
    const negEnd = along0 - negSteps / 2;
    if (!widthAt(negEnd, atDeck)) continue;
    if (!widthAt(along0 + posSteps / 2, atDeck)) continue;
    let gapsClear = true;
    for (let s = -(negSteps - 2); s <= posSteps - 2; s++) {
      if (!widthAt(along0 + s / 2, belowDeck)) { gapsClear = false; break; }
    }
    if (!gapsClear) continue;

    // Snap: the footprint rests on the near end and reaches over the gap (the
    // far end supports the far tip), spanLength = gap + 1 (matches the original).
    // Across the deck the anchor's own coordinate stands, half offset included.
    const spanLength = gapCount + 1;
    const startX = dir.dx === 1 ? negEnd : anchor.x;
    const startY = dir.dy === 1 ? negEnd : anchor.y;
    const cells: MacroCoord[] = [];
    for (let s = 0; s < spanLength; s++) {
      for (let w = 0; w < width; w++) {
        cells.push(dir.dx === 1 ? { x: startX + s, y: startY + w } : { x: startX + w, y: startY + s });
      }
    }
    return { rotation: dir.rot, position: { x: startX, y: startY }, spanLength, elevation: deckE, cells };
  }

  return null;
}
