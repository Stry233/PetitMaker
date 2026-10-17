import type { CellEvidence } from './evidence';

// The grass edge's north-south offset, read per recording. On the reference recordings the colour
// edge of every north and south grass edge sits north of the cell line it lies on, by a different
// amount in each recording, while the east and west edges stay on theirs. Seen from different tile
// positions the same edge shows no lean growing with the distance from the camera's foot, so it is
// corrected as an offset, not as a height. Game edges lie on cell lines, so a recording's own straight edges measure
// it: the mean phase of its north and south edges against the lines, which a uniform widening or
// narrowing of the grass leaves out. East and west edges must sit on the lines; where they do not,
// the lattice itself is off and no offset is read. The grass vote is then read that far north.

/** How the offset is read, in cells (`SCAN_PROFILE.ground.grassShift`). */
export interface GrassShiftSettings {
  /** A clean edge: grass vote at least `vote` on one side and, on the other, grass at most 1 - `vote`
   *  and sea at most `sea`, for `clear` cells either way. */
  readonly vote: number;
  readonly sea: number;
  readonly clear: number;
  /** A straight edge: met within `straight` cells by a crossing the same way on every sample line
   *  within `span` cells along it. */
  readonly straight: number;
  readonly span: number;
  /** Cells of straight edge each facing needs. */
  readonly minEdges: number;
  /** The largest offset read; a larger one reads as none. */
  readonly maxShift: number;
  /** East and west edges further than this off the lines read as no offset. */
  readonly eastWestTolerance: number;
}

/** A recording's grass edge offset and what it was read from. */
export interface GrassShift {
  /** In cells north, as the reading applies it: `measured`, or 0 where it was not read or refused. */
  readonly shift: number;
  /** The north shift of the north and south edges against the lines; NaN unread. */
  readonly measured: number;
  /** The east shift of the east and west edges against the lines; NaN unread. */
  readonly eastShift: number;
  /** Cells of straight edge read per facing. */
  readonly edges: { readonly north: number; readonly south: number; readonly east: number; readonly west: number };
}

interface AxisPhases {
  /** Circular mean phase in cells, (-0.5, 0.5], of edges with grass after / before the crossing along
   *  the axis; NaN without edges. */
  readonly rising: number;
  readonly falling: number;
  readonly risingCells: number;
  readonly fallingCells: number;
}

/** The straight grass/sand edges across one axis of the sample raster. */
function axisPhases(ev: CellEvidence, vertical: boolean, L: GrassShiftSettings): AxisPhases {
  const { width, height, grass, sea } = ev.points;
  const s = ev.sub;
  const lines = vertical ? width : height;
  const length = vertical ? height : width;
  const at = (line: number, k: number) => (vertical ? k * width + line : line * width + k);
  const reach = Math.max(1, Math.round(L.clear * s));
  const crossings: { pos: number; rising: boolean }[][] = [];
  for (let line = 0; line < lines; line++) {
    const list: { pos: number; rising: boolean }[] = [];
    for (let k = reach; k < length - reach - 1; k++) {
      const a = grass[at(line, k)]!, b = grass[at(line, k + 1)]!;
      if ((a - 0.5) * (b - 0.5) >= 0) continue;
      const rising = b > a;
      let clean = true;
      for (let q = 1; q <= reach && clean; q++) {
        const g = at(line, rising ? k + 1 + q : k - q), o = at(line, rising ? k - q : k + 1 + q);
        if (grass[g]! < L.vote || grass[o]! > 1 - L.vote || sea[o]! > L.sea) clean = false;
      }
      if (clean) list.push({ pos: (k + 0.5 + (a - 0.5) / (a - b)) / s, rising });
    }
    crossings.push(list);
  }
  const span = Math.round(L.span * s);
  const sums = { rising: [0, 0, 0], falling: [0, 0, 0] };
  for (let line = span; line < lines - span; line++) {
    for (const c of crossings[line]!) {
      let straight = true;
      for (let d = -span; d <= span && straight; d++) {
        if (!crossings[line + d]!.some((e) => e.rising === c.rising && Math.abs(e.pos - c.pos) < L.straight)) straight = false;
      }
      if (!straight) continue;
      const sum = c.rising ? sums.rising : sums.falling;
      sum[0]! += Math.cos(2 * Math.PI * c.pos);
      sum[1]! += Math.sin(2 * Math.PI * c.pos);
      sum[2]! += 1;
    }
  }
  const phase = (sum: number[]) => (sum[2]! > 0 ? Math.atan2(sum[1]!, sum[0]!) / (2 * Math.PI) : Number.NaN);
  return { rising: phase(sums.rising), falling: phase(sums.falling), risingCells: sums.rising[2]! / s, fallingCells: sums.falling[2]! / s };
}

/** The grass edge offset of a recording, from its own straight grass edges. */
export function grassShift(ev: CellEvidence, settings: GrassShiftSettings): GrassShift {
  const ns = axisPhases(ev, true, settings);
  const ew = axisPhases(ev, false, settings);
  const edges = { north: ns.risingCells, south: ns.fallingCells, east: ew.fallingCells, west: ew.risingCells };
  const enough = (a: number, b: number) => a >= settings.minEdges && b >= settings.minEdges;
  // An offset moves both facings' phases alike; a widening moves them apart.
  const measured = enough(edges.north, edges.south) ? -(ns.rising + ns.falling) / 2 : Number.NaN;
  const eastShift = enough(edges.east, edges.west) ? (ew.rising + ew.falling) / 2 : Number.NaN;
  const read = Math.abs(eastShift) <= settings.eastWestTolerance && Math.abs(measured) <= settings.maxShift;
  return { shift: read ? measured : 0, measured, eastShift, edges };
}

/** The evidence with the grass vote read `shift` cells north; every other plane is the ground's. */
export function shiftGrass(ev: CellEvidence, shift: number): CellEvidence {
  if (shift === 0) return ev;
  const { width, height, grass, weight } = ev.points;
  const d = shift * ev.sub;
  const out = new Float32Array(grass.length);
  for (let j = 0; j < height; j++) {
    const y = Math.max(0, Math.min(height - 1, j - d));
    const y0 = Math.min(height - 2, Math.floor(y)), f = y - y0;
    for (let i = 0; i < width; i++) {
      const p = j * width + i;
      out[p] = weight[p]! > 0 ? grass[y0 * width + i]! * (1 - f) + grass[(y0 + 1) * width + i]! * f : grass[p]!;
    }
  }
  return { ...ev, points: { ...ev.points, grass: out } };
}
