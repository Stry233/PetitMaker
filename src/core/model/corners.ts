/**
 * The corner index convention and corner adjacency. A cell's `Corners` tuple is ordered
 * [0, 1, 2, 3] = top-left, top-right, bottom-left, bottom-right, so index = row * 2 + column.
 * `CORNERS` is the one table of what meets each corner; the silhouette kernel, the cut validator,
 * the lock rule, patch quadrants and the renderers' cut backing read it.
 *
 * Two label systems name the same four positions: screen quadrants (`CornerPos`, the renderers'
 * vocabulary) and compass points (`CornerCompass`, the `CornerTrim` 'tri-XX' suffixes and the agent
 * trim_corner API). NW=TL, NE=TR, SW=BL, SE=BR.
 */
import type { CornerTrim, Corners } from './types';
import { SIDE_DELTA, type Side } from '../grid/directions';

export type CornerPos = 'TL' | 'TR' | 'BL' | 'BR';
export type CornerCompass = 'NW' | 'NE' | 'SW' | 'SE';
type Offset = readonly [number, number];

export interface CornerAdjacency {
  readonly pos: CornerPos;
  readonly compass: CornerCompass;
  /** The two cell sides the corner lies on, the north or south side first. */
  readonly sides: readonly [Side, Side];
  /** The two edge-sharing neighbours, the west or east one first. */
  readonly edges: readonly [Offset, Offset];
  /** The neighbour that touches the cell only at this corner. */
  readonly diagonal: Offset;
}

function corner(pos: CornerPos, compass: CornerCompass, v: 'N' | 'S', h: 'W' | 'E'): CornerAdjacency {
  const [vx, vy] = SIDE_DELTA[v], [hx, hy] = SIDE_DELTA[h];
  return { pos, compass, sides: [v, h], edges: [SIDE_DELTA[h], SIDE_DELTA[v]], diagonal: [hx + vx, hy + vy] };
}

/** Corner index → its labels, the sides it lies on and the three cells that meet there. */
export const CORNERS: readonly CornerAdjacency[] = [
  corner('TL', 'NW', 'N', 'W'),
  corner('TR', 'NE', 'N', 'E'),
  corner('BL', 'SW', 'S', 'W'),
  corner('BR', 'SE', 'S', 'E'),
];

/** index → screen-quadrant label. */
export const CORNER_POS: readonly CornerPos[] = CORNERS.map((c) => c.pos);
/** screen-quadrant label → index. */
export const CORNER_INDEX = Object.fromEntries(CORNERS.map((c, i) => [c.pos, i])) as Readonly<Record<CornerPos, number>>;
/** index → compass label (the `CornerTrim` 'tri-XX' suffix and the agent's corner vocabulary). */
export const CORNER_COMPASS: readonly CornerCompass[] = CORNERS.map((c) => c.compass);

/** The two corner indices on `side`, in index order (left to right along N and S, top to bottom along W and E). */
export function cornersOnSide(side: Side): readonly [number, number] {
  const on = CORNERS.flatMap((c, i) => (c.sides.includes(side) ? [i] : []));
  return [on[0]!, on[1]!];
}

/** The triangle trim that keeps corner `i`'s own quadrant toward its corner point ('tri-NW' at TL). */
export function cornerTri(i: number): CornerTrim {
  return `tri-${CORNERS[i]!.compass}`;
}

/** A cell with no corner cut. Spread it where a mutable `Corners` is stored. */
export const SQUARE_CORNERS: Readonly<Corners> = ['square', 'square', 'square', 'square'];
/** Every corner cut away: as a command's `afterCorners`, it removes the terrain or road. */
export const EMPTY_CORNERS: Readonly<Corners> = ['empty', 'empty', 'empty', 'empty'];

/** True when no corner is cut; an absent tuple is square. */
export function isSquareCorners(c: readonly CornerTrim[] | null | undefined): boolean {
  return !c || c.every(t => t === 'square');
}

/** True when every corner is cut away. */
export function isEmptyCorners(c: readonly CornerTrim[]): boolean {
  return c.every(t => t === 'empty');
}

/** A fresh, mutable copy of a corner tuple. */
export function copyCorners(corners: Readonly<Corners>): Corners {
  return [corners[0], corners[1], corners[2], corners[3]];
}

/** A new corner tuple with `fn` applied to each corner in index order. */
export function mapCorners(corners: Readonly<Corners>, fn: (trim: CornerTrim, index: number) => CornerTrim): Corners {
  return [fn(corners[0], 0), fn(corners[1], 1), fn(corners[2], 2), fn(corners[3], 3)];
}

/** True when both tuples hold the same trim at every index. */
export function sameCorners(a: Readonly<Corners>, b: Readonly<Corners>): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
