/*
 * Bridge span detection shared by the placement rule (V-PLACE-TRAIT waterSpan) and the placement
 * ghost. A bridge spans two flat ends of equal height across a gap within [min, max]; the gap may be
 * water, off-map void or lower terrain. Detection reads an effective level where water and off-map
 * sit below everything and scans out from the clicked gap cell.
 *
 * The anchor may sit on a half cell (the halfStep trait), so the walk steps in half macros with
 * micro-unit arithmetic (1 macro = 2 micro). A half probe straddles two cells and reads their min,
 * so a deck end never rests half on rock and half on water. That also keeps both ends on whole
 * coordinates, so the span length is whole and only the across axis carries a half offset.
 */
import { TerrainType } from '../../model/types';
import type { GridState, MacroCoord, PlacedObject } from '../../model/types';
import { getCell } from '../../model/grid-model';
import { onHalfGrid, straddledCells } from '../../grid/rect';
import { realSurface } from './terrain-surface';
import { terrainCellAt } from '../../grid/grid-convert';

interface BridgeSpan {
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
 *  (`terrainCellAt`); the span coordinate passes through
 *  as it is, so a half one is read as the straddle it names. */
function fullWidth(
  state: GridState, at: MacroCoord, perp: { px: number; py: number }, width: number,
  test: (level: number) => boolean,
): boolean {
  const { x, y } = at;
  const { px: perpDx, py: perpDy } = perp;
  const mx = Math.round(x * 2), my = Math.round(y * 2);
  for (let m = 0; m < width * 2; m++) {
    const cx = perpDx ? terrainCellAt((mx + perpDx * m) / 2, 0).x : x;
    const cy = perpDy ? terrainCellAt(0, (my + perpDy * m) / 2).y : y;
    if (!test(effLevel(state, cx, cy))) return false;
  }
  return true;
}

/** A deck `width` wide along `dir` from `negEnd` to `posEnd`, at `across` on the other axis, its
 *  top at `level`. */
interface Deck {
  dir: (typeof DIRS)[number];
  negEnd: number;
  posEnd: number;
  across: number;
  width: number;
  level: number;
}

/** Whether `deck` stands: both ends flat at its level over the full width, and every half step
 *  between them below it. */
function deckHolds(state: GridState, { dir, negEnd, posEnd, across, width, level }: Deck): boolean {
  const widthAt = (a: number, test: (lvl: number) => boolean): boolean =>
    dir.dx ? fullWidth(state, { x: a, y: across }, dir, width, test)
           : fullWidth(state, { x: across, y: a }, dir, width, test);
  const atDeck = (lvl: number) => lvl === level;
  const belowDeck = (lvl: number) => lvl < level;
  if (!widthAt(negEnd, atDeck) || !widthAt(posEnd, atDeck)) return false;
  for (let half = (negEnd + 1) * 2; half <= (posEnd - 1) * 2; half++) {
    if (!widthAt(half / 2, belowDeck)) return false;
  }
  return true;
}

/**
 * Whether `deck`, a bridge as `detectBridgeSpan` snaps one (rotation, position, span length and
 * elevation), stands where it is: a snapped bridge is its own resolution, which detection from its
 * position cannot reproduce, since the position rests on the near end rather than in the gap.
 */
export function bridgeSpanHolds(
  state: GridState, deck: Pick<PlacedObject, 'position' | 'rotation' | 'spanLength' | 'elevation'>,
  width: number, min: number, max: number,
): boolean {
  const dir = DIRS.find((d) => d.rot === deck.rotation);
  const { position: p, spanLength } = deck;
  if (!dir || spanLength === undefined || !onHalfGrid(p.x) || !onHalfGrid(p.y)) return false;
  if (spanLength - 1 < min || spanLength - 1 > max) return false;
  const negEnd = dir.dx ? p.x : p.y;
  return deckHolds(state, { dir, negEnd, posEnd: negEnd + spanLength, across: dir.dx ? p.y : p.x, width, level: deck.elevation });
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
    // The deck's first micro column resolves the across coordinate to one real cell,
    // so the centre line the walk follows is a row of the deck rather than the
    // boundary between two of them; fullWidth keeps the raw coordinate instead,
    // since it walks the deck's own micro columns.
    const acrossLine = Math.ceil(dir.dx ? anchor.y : anchor.x);
    const acrossRaw = dir.dx ? anchor.y : anchor.x;
    const levelAt = (a: number): number =>
      dir.dx ? effLevel(state, a, acrossLine) : effLevel(state, acrossLine, a);

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

    const negEnd = along0 - negSteps / 2;
    if (!deckHolds(state, { dir, negEnd, posEnd: along0 + posSteps / 2, across: acrossRaw, width, level: deckE })) continue;

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
