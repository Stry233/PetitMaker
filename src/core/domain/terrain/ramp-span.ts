/*
 * Ramp detection for the placement rule (V-PLACE-TRAIT heightDrop), and the mapping between a
 * ramp's rotation and how its stored footprint lies against the cliff it climbs.
 *
 * A ramp facing +y or +x (rotation 0 or 90) stores its footprint from the high cell of the step; one
 * facing -y or -x (180 or 270) stores it one footprint length back, ending one short of the high cell.
 */
import { TerrainType, type GridState, type MacroCoord, type PlacedObject, type Rotation } from '../../model/types';
import { getCell } from '../../model/grid-model';
import { straddledCells } from '../../grid/rect';
import { terrainRun } from '../../grid/footprint';
import { realSurface, surfaceElevation } from './terrain-surface';

interface RampSpan {
  rotation: Rotation;
  /** Top-left of the footprint. */
  position: MacroCoord;
  /** The high end's elevation, which the ramp stores. */
  elevation: number;
}

/** How a ramp at `rotation` lies: the axis its span runs along, and whether its high end is at
 *  the low-coordinate end of that axis. */
export function rampOrientation(rotation: Rotation): { spanAxis: 'x' | 'y'; highAtStart: boolean } {
  return { spanAxis: rotation === 0 || rotation === 180 ? 'y' : 'x', highAtStart: rotation === 0 || rotation === 90 };
}

const CARDINAL_OFFSETS: readonly MacroCoord[] = [
  { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
];

/** Where a heightDrop looks for its cliff: each cardinal direction in turn, nearest step first.
 *  A half anchor sits on a cell boundary, so the half step is what reads the two cells it
 *  divides. From a whole anchor that same step straddles the anchor's own cell, so its min read
 *  can only match when the neighbour is the lower one, and then it reports the very numbers the
 *  whole step reports: the whole grid resolves identically either way. */
const RAMP_PROBES: readonly { dx: number; dy: number; dist: number }[] =
  CARDINAL_OFFSETS.flatMap((off) => [0.5, 1].map((dist) => ({ dx: off.x, dy: off.y, dist })));

/** Min-support surface elevation over the ramp's across span at the cells `along` straddles, or
 *  null when any of them is off the map: a probe that reaches the void has no cliff to report,
 *  and support counts only where every read cell holds it.
 *
 *  The across extent is the ramp's own (`terrainRun` of the anchor's perpendicular coordinate),
 *  not the anchor point's half-cell straddle: those two read different columns for a half anchor,
 *  whose footprint starts half a cell past it. Read at the point, a ramp hugging a cliff's
 *  left/top end straddles the ground beside the plateau, the min goes low, and no cliff is ever
 *  detected there — while the right/bottom end, straddling two plateau cells, works. Reading the
 *  cells the support sweep itself will read is what makes the four ends agree. */
function spanElevation(
  state: GridState, vertical: boolean, along: number, across: { lo: number; hi: number },
): number | null {
  const alongCells = straddledCells(along);
  let elev = Infinity;
  for (let a = alongCells.lo; a <= alongCells.hi; a++) {
    for (let p = across.lo; p <= across.hi; p++) {
      const cell = getCell(state.cells, vertical ? p : a, vertical ? a : p);
      if (!cell) return null;
      elev = Math.min(elev, surfaceElevation(cell.terrain));
    }
  }
  return elev;
}

/**
 * The ramp a `perpWidth` × `spanLen` heightDrop item anchored at `pos` resolves to: a cliff exactly
 * `layers` high beside the anchor, with land at the profile's two levels under the whole footprint.
 * Null when no direction holds one.
 */
export function detectRampSpan(
  state: GridState, pos: MacroCoord, perpWidth: number, spanLen: number, layers: number,
): RampSpan | null {
  const acrossX = terrainRun(pos.x, perpWidth, 'x');
  const acrossY = terrainRun(pos.y, perpWidth, 'y');

  for (const probe of RAMP_PROBES) {
    const vertical = probe.dy !== 0;
    const across = vertical ? acrossX : acrossY;
    const anchorAlong = vertical ? pos.y : pos.x;
    const anchorElev = spanElevation(state, vertical, anchorAlong, across) ?? 0;
    const step = vertical ? probe.dy : probe.dx;
    const neighborElev = spanElevation(state, vertical, anchorAlong + step * probe.dist, across);
    if (neighborElev === null) continue;   // off-map: no cliff to read
    if (Math.abs(anchorElev - neighborElev) !== layers) continue;

    const anchorIsHigh = anchorElev >= neighborElev;
    const hElev = Math.max(anchorElev, neighborElev);
    const lElev = Math.min(anchorElev, neighborElev);
    const highX = anchorIsHigh ? pos.x : pos.x + probe.dx * probe.dist;
    const highY = anchorIsHigh ? pos.y : pos.y + probe.dy * probe.dist;
    const slopeDx = anchorIsHigh ? probe.dx : -probe.dx;
    const slopeDy = anchorIsHigh ? probe.dy : -probe.dy;

    // rot=0/90: include high cell (mountain in the terrain-offset gap direction)
    // rot=180/270: exclude high cell (mountain overlaps naturally)
    //
    // The along coordinate is rounded to the whole cell `terrainRun` reads (floor(v+0.5)): an
    // anchorIsHigh anchor or a doubly-half hover can arrive fractional. The across slot keeps its
    // half freedom. A tie rounds toward the slope, onto the cliff row on the downhill side, which
    // half-up rounding gets wrong for rot 180/270.
    const halfDown = (v: number) => Math.ceil(v - 0.5);
    let rot: Rotation;
    let px: number, py: number;
    if (slopeDy > 0) { rot = 0; px = highX; py = Math.round(highY); }
    else if (slopeDx > 0) { rot = 90; px = Math.round(highX); py = highY; }
    else if (slopeDy < 0) { rot = 180; px = highX; py = halfDown(highY) - spanLen; }
    else { rot = 270; px = halfDown(highX) - spanLen; py = highY; }
    if (!profileHolds(state, { rotation: rot, position: { x: px, y: py } }, [hElev, lElev], perpWidth, spanLen)) continue;
    return { rotation: rot, position: { x: px, y: py }, elevation: hElev };
  }
  return null;
}

/**
 * Whether the terrain under a ramp at `rot` and `pos` matches its profile. Terrain renders on the
 * terrain grid (up-left), so a whole-anchored footprint is visually overlapped by one extra cell on
 * each axis, while a half-anchored one lands exactly on the cells it covers — `terrainRun` answers
 * both. Each swept cell must match the ramp's elevation profile: the cell at the cliff end carries
 * the high plateau, every other one the run below it. That end faces the low run for a down-ramp
 * (highAtStart) and the plateau for an up-ramp (the cliff "overlaps naturally"), so both ramp
 * directions require a 1-high end and a spanLen-low run with flat support at each.
 */
function profileHolds(
  state: GridState, { rotation: rot, position: pos }: Pick<PlacedObject, 'position' | 'rotation'>,
  [hElev, lElev]: readonly [high: number, low: number], perpWidth: number, spanLen: number,
): boolean {
  const { spanAxis, highAtStart } = rampOrientation(rot);
  const isVert = spanAxis === 'y';
  const along = terrainRun(isVert ? pos.y : pos.x, spanLen, isVert ? 'y' : 'x');
  const perp = terrainRun(isVert ? pos.x : pos.y, perpWidth, isVert ? 'x' : 'y');
  const highCell = highAtStart ? along.lo : along.hi;
  for (let a = along.lo; a <= along.hi; a++) {
    const exp = a === highCell ? hElev : lElev;
    for (let p = perp.lo; p <= perp.hi; p++) {
      // the surface must be land at the expected level — water at the right
      // elevation (a lake in the low run, a pool rim as the "cliff") is not support
      const surf = realSurface(getCell(state.cells, isVert ? p : a, isVert ? a : p)?.terrain);
      if (surf?.type === TerrainType.Water || (surf?.elevation ?? 0) !== exp) return false;
    }
  }
  return true;
}

/**
 * Whether `ramp`, as `detectRampSpan` snaps one (rotation, position and the high end's elevation),
 * stands where it is: a snapped ramp is its own resolution, which detection from its position need
 * not reproduce, since that position is the footprint's corner rather than the anchor.
 */
export function rampSpanHolds(
  state: GridState, ramp: Pick<PlacedObject, 'position' | 'rotation' | 'elevation'>,
  perpWidth: number, spanLen: number, layers: number,
): boolean {
  return profileHolds(state, ramp, [ramp.elevation, ramp.elevation - layers], perpWidth, spanLen);
}
