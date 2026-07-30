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
 */
import { TerrainType } from './types';
import type { GridState, MacroCoord } from './types';
import { getCell } from './grid-model';
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

/**
 * Height a bridge sees a cell at: water and off-map read as -1 (a spannable
 * gap, below any real ground), bare ground as 0, mountains as their elevation.
 */
function effLevel(state: GridState, x: number, y: number): number {
  const cell = getCell(state.cells, x, y);
  if (!cell) return -1;                                   // off-map / void
  const surf = realSurface(cell.terrain);                 // Γ fillets read as their base (kernel semantics)
  if (!surf) return 0;                                    // bare ground
  if (surf.type === TerrainType.Water) return -1;         // water
  return surf.elevation;
}

/** True iff every micro-block across the bridge's perpendicular width satisfies `test`. */
function fullWidth(
  state: GridState, x: number, y: number,
  perpDx: number, perpDy: number, width: number,
  test: (level: number) => boolean,
): boolean {
  for (let m = 0; m < width * 2; m++) {
    const microX = x * 2 + perpDx * m;
    const microY = y * 2 + perpDy * m;
    const tx = Math.ceil(microX / 2);
    const ty = Math.ceil(microY / 2);
    if (!test(effLevel(state, tx, ty))) return false;
  }
  return true;
}

/**
 * Detect a legal bridge span anchored at `anchor` (a clicked gap cell). Returns
 * the snapped placement, or null if no valid span exists in either orientation.
 */
export function detectBridgeSpan(
  state: GridState, anchor: MacroCoord, width: number, min: number, max: number,
): BridgeSpan | null {
  const anchorLvl = effLevel(state, anchor.x, anchor.y);

  for (const dir of DIRS) {
    // Walk the centre line out to the first raised cell on each side — the ends.
    let negDist = -1, posDist = -1, eN = -1, eP = -1;
    for (let i = 1; i <= max + 2; i++) {
      const lvl = effLevel(state, anchor.x - dir.dx * i, anchor.y - dir.dy * i);
      if (lvl > anchorLvl) { negDist = i; eN = lvl; break; }
    }
    for (let i = 1; i <= max + 2; i++) {
      const lvl = effLevel(state, anchor.x + dir.dx * i, anchor.y + dir.dy * i);
      if (lvl > anchorLvl) { posDist = i; eP = lvl; break; }
    }
    if (negDist < 0 || posDist < 0) continue;  // no raised end on one side
    if (eN !== eP) continue;                    // ends must be the same height
    const deckE = eN;
    const gapCount = negDist + posDist - 1;     // cells spanned (incl. the anchor)
    if (gapCount < min || gapCount > max) continue;

    // Full-width checks: both ends flat at the deck height, every gap cell below it.
    const atDeck = (lvl: number) => lvl === deckE;
    const belowDeck = (lvl: number) => lvl < deckE;
    const negEnd = { x: anchor.x - dir.dx * negDist, y: anchor.y - dir.dy * negDist };
    const posEnd = { x: anchor.x + dir.dx * posDist, y: anchor.y + dir.dy * posDist };
    if (!fullWidth(state, negEnd.x, negEnd.y, dir.px, dir.py, width, atDeck)) continue;
    if (!fullWidth(state, posEnd.x, posEnd.y, dir.px, dir.py, width, atDeck)) continue;
    let gapsClear = true;
    for (let i = -(negDist - 1); i <= posDist - 1; i++) {
      const gx = anchor.x + dir.dx * i, gy = anchor.y + dir.dy * i;
      if (!fullWidth(state, gx, gy, dir.px, dir.py, width, belowDeck)) { gapsClear = false; break; }
    }
    if (!gapsClear) continue;

    // Snap: the footprint rests on the near end and reaches over the gap (the
    // far end supports the far tip), spanLength = gap + 1 (matches the original).
    const spanLength = gapCount + 1;
    const startX = dir.dx === 1 ? anchor.x - negDist : anchor.x;
    const startY = dir.dy === 1 ? anchor.y - negDist : anchor.y;
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
