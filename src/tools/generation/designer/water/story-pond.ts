/**
 * Where the water story arrives: the coast it can run out to, or the pond cut at its end in one of
 * the authored pond shapes.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4_ESWN } from '../../../../core/grid/directions';
import type { MacroCoord } from '../../../../core/model/types';
import type { TerrainPlan } from '../../terrain-plan/types';
import { boundsOfCells, cellsFit, floodCells } from './water-cut';
import { seedHash01 } from '../../../../core/base/hash';
import { lerpClamped } from '../../../../core/base/math';
import { type PondShape, type StoryInput, type StoryPond, type Vec, left, pondCells, right } from './story-model';

/** The destination pond: its span at richness 0 and 1, and the smallest it may be trimmed to. A
 *  shaped pool reads 6x7 to 15x17. */
const POND_SPAN = { min: 7, max: 17 } as const;
const POND_MIN = 4;
/** How far back along its last reach the course looks for room to arrive in. */
const POND_BACKTRACK = 24;

/** Whether the head stands at ground level against the coast: the course has arrived at the sea. */
export function touchesSea(t: TerrainPlan, grass: Uint8Array, at: MacroCoord, tier: number): boolean {
  if (tier !== 0) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = at.x + dx, y = at.y + dy;
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
      if (!grass[flatIndex(x, y, t.width)]) return true;
    }
  }
  return false;
}

/**
 * The arrival, tried at the head and then back along the last reach.
 *
 * A pond wants a clear patch of one terrace, and the cell a course happens to stop at is the cell
 * that had none — that is why the course stopped there, and asking only at the head refuses the pond
 * and with it the whole story. So the last reach is
 * walked backwards a cell at a time, and each position is offered the four directions: the pond only
 * has to touch the course, not lie ahead of it.
 */
export function arrive(
  input: StoryInput, spine: readonly MacroCoord[], head: MacroCoord, dir: Vec, tier: number,
): StoryPond | null {
  const tries: { at: MacroCoord; dir: Vec }[] = [{ at: head, dir }];
  for (let k = spine.length - 1; k > 0 && tries.length <= POND_BACKTRACK; k--) {
    const a = spine[k - 1]!, b = spine[k]!;
    if (input.t.water[flatIndex(b.x, b.y, input.t.width)] !== tier) break;
    const step: Vec = [Math.sign(b.x - a.x), Math.sign(b.y - a.y)];
    tries.push({ at: b, dir: step[0] === 0 && step[1] === 0 ? dir : step });
  }
  for (const each of tries) {
    for (const d of [each.dir, left(each.dir), right(each.dir), [-each.dir[0], -each.dir[1]] as Vec]) {
      const pond = cutPond(input, each.at, d, tier);
      if (pond) return pond;
    }
  }
  return null;
}

/**
 * The pond the course arrives in: one of four shapes, framed by the terrace it is cut into.
 *
 * The shape is drawn as a cell set and the whole set is judged at once, so a lozenge is a lozenge or it
 * is nothing — a pond trimmed side by side comes back a rectangle. What is negotiable is its span: the
 * box shrinks a cell at a time until the terrace carries it.
 */
function cutPond(input: StoryInput, at: MacroCoord, dir: Vec, tier: number): StoryPond | null {
  const { t, grass, flat, richness, seed } = input;
  const first = Math.floor(seedHash01(seed ^ 0x9d13, tier + 1) * POND_SHAPES.length);
  const span = Math.round(lerpClamped(POND_SPAN.min, POND_SPAN.max, richness));
  for (let w = span; w >= POND_MIN; w--) {
    // Every shape is offered at each span, the seed's own first. Trying one shape down to its
    // smallest span before the next would make the span, not the composition, decide what a map's
    // arrival looks like.
    for (let k = 0; k < POND_SHAPES.length; k++) {
      const shape = POND_SHAPES[(first + k) % POND_SHAPES.length]!;
      const h = Math.max(POND_MIN, Math.round(w * (shape === 'diamond' ? 1 : 0.7)));
      // The box opens ahead of the head and centred across the flow, so the course runs into it.
      const rect: Rect = dir[0] !== 0
        ? { x: dir[0] > 0 ? at.x + 1 : at.x - w, y: at.y - ((h - 1) >> 1), w, h }
        : { x: at.x - ((w - 1) >> 1), y: dir[1] > 0 ? at.y + 1 : at.y - h, w, h };
      const cells = pondCells(shape, rect);
      if (cells.length < POND_MIN * 2) continue;
      if (!cellsFit(t, grass, flat, cells, tier)) continue;
      if (!cells.some((c) => touchesCourse(t, c, tier))) continue;
      floodCells(t, cells, tier);
      return { shape, rect: boundsOfCells(cells), tier, cells };
    }
  }
  return null;
}

const POND_SHAPES: readonly PondShape[] = ['lozenge', 'u-moat', 'islet', 'diamond'];

/** Whether a candidate pond cell is 4-adjacent to water the course already laid, so the pond and the
 *  stream come out as one body rather than as a pond beside a stream. */
function touchesCourse(t: TerrainPlan, c: MacroCoord, tier: number): boolean {
  for (const d of NEIGHBORS4_ESWN) {
    const x = c.x + d[0], y = c.y + d[1];
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
    if (t.water[flatIndex(x, y, t.width)] === tier) return true;
  }
  return false;
}
