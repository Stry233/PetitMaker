/* Cell sides, neighbour offsets and compass directions on a cell grid; y grows south. */
import type { Rotation } from '../base/coords';

/** A cell's four edges as compass sides, clockwise from north; y grows south. */
export const SIDES = ['N', 'E', 'S', 'W'] as const;

export type Side = typeof SIDES[number];

/** The unit step to the cell across each side: the one source of edge-neighbour offsets. */
export const SIDE_DELTA: Readonly<Record<Side, readonly [number, number]>> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

const stepsAcross = (order: readonly Side[]) => order.map((s) => SIDE_DELTA[s]);

/** The four edge neighbours in scan order E, W, S, N. Floods and searches iterate in this order,
 *  so their output depends on it. */
export const NEIGHBORS4: ReadonlyArray<readonly [number, number]> = stepsAcross(['E', 'W', 'S', 'N']);

/** The four edge neighbours clockwise from east; water stories index into it (1 is south). */
export const NEIGHBORS4_ESWN: ReadonlyArray<readonly [number, number]> = stepsAcross(['E', 'S', 'W', 'N']);

/** The four edge neighbours clockwise from north, in `SIDES` order. */
export const NEIGHBORS4_NESW: ReadonlyArray<readonly [number, number]> = stepsAcross(SIDES);

/** The eight neighbour offsets: `NEIGHBORS4`, then the diagonals. */
export const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [...NEIGHBORS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const OPPOSITE_SIDE: Readonly<Record<Side, Side>> = { N: 'S', E: 'W', S: 'N', W: 'E' };

/** A side named as a compass word, the vocabulary tools and the assistant speak. */
export type Direction = 'north' | 'south' | 'east' | 'west';

/** The side each compass word names. */
export const DIRECTION_SIDE: Readonly<Record<Direction, Side>> = { north: 'N', south: 'S', west: 'W', east: 'E' };

const offsetOf = (d: Direction) => ({ dx: SIDE_DELTA[DIRECTION_SIDE[d]][0], dy: SIDE_DELTA[DIRECTION_SIDE[d]][1] });
export const DIR_OFFSETS: Record<Direction, { dx: number; dy: number }> = {
  north: offsetOf('north'), south: offsetOf('south'), west: offsetOf('west'), east: offsetOf('east'),
};

/** The direction across from each direction. */
export const OPPOSITE_DIR: Readonly<Record<Direction, Direction>> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
};

/** The direction an object's front (a building's door) faces at each rotation: south at 0, then a
 *  quarter turn clockwise on screen per step. */
export const ROTATION_FACING: Readonly<Record<Rotation, Direction>> = {
  0: 'south', 90: 'west', 180: 'north', 270: 'east',
};

export const PERP_DIRS: Record<Direction, [Direction, Direction]> = {
  north: ['west', 'east'],
  south: ['west', 'east'],
  west:  ['north', 'south'],
  east:  ['north', 'south'],
};
