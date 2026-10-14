/**
 * The symmetry operator, local to what one view takes in: a kit's marks are reflected about the
 * place's own axis, never the map's.
 *
 * The reflection is exact and the ground is not: a mark is kept only where its reflection can be
 * planted too, and both are emitted, so the arrangement mirrors exactly (the mirror score matches
 * only the same species at the mirrored cell). Imperfect symmetry is the aim: about two thirds of a
 * planet's decorated regions mirror, so `formalShare` is how often a region is composed
 * symmetrically, and an informal one keeps what its kit laid.
 *
 * Pure: no state, no commands, no catalog. Deterministic per (marks, axis).
 */
import type { Rect } from '../../../../core/grid/rect';
import type { Rng } from '../../../../core/base/rng';
import { cellKey } from '../../../../core/grid/rect';

/** Which coordinate the mirror flips: `v` a vertical axis (x flips, a left/right mirror), `h` a
 *  horizontal one (y flips): the two axes a place is read as mirrored about. */
export type Axis = 'v' | 'h';

/** A mirror line, carried as twice its coordinate so a half-cell axis stays an integer: a box from
 *  `x0` to `x0 + w - 1` mirrors about `2*x0 + w - 1`, which is odd for an even-width box (the axis
 *  runs between two cells) and even for an odd-width one (it runs down the middle column). */
export interface Mirror { axis: Axis; twice: number }

export interface Mark { x: number; y: number; catalogId: string }

/**
 * The mirror through a box's centre, snapped so that the doubled coordinate is even.
 *
 * An even line preserves a cell's parity under reflection, and a tree lattice is laid on one parity
 * across the whole map because every tree carries an exclusion radius of a cell. Mirroring an
 * orchard about a half-cell line would put its image on the other parity, one cell from the trees it
 * was reflected from, and the rules would refuse it. The cost is half a cell of off-centre, which no
 * one can see; the alternative is half an orchard.
 */
export function mirrorOf(box: Rect, axis: Axis): Mirror {
  const twice = axis === 'v' ? 2 * box.x + box.w - 1 : 2 * box.y + box.h - 1;
  return { axis, twice: twice - (twice & 1) };
}

/** Where a cell lands on the other side of the mirror. */
export function reflect(m: Mirror, x: number, y: number): { x: number; y: number } {
  return m.axis === 'v' ? { x: m.twice - x, y } : { x, y: m.twice - y };
}

/**
 * The mirrored arrangement: every mark whose reflection can also be planted, plus that reflection.
 *
 * A mark on the axis reflects onto itself and is emitted once. A mark whose reflection is already
 * spoken for by a different species is dropped with its own cell, since a half pair is exactly what
 * the mirror score does not count.
 *
 * @param canPlant whether a cell may carry a plant at all (plantable ground, nothing standing on it)
 */
export function symmetrize(
  marks: readonly Mark[], m: Mirror, canPlant: (x: number, y: number) => boolean,
): Mark[] {
  const wanted = new Map<string, string>();
  for (const mark of marks) {
    const key = cellKey(mark.x, mark.y);
    if (!wanted.has(key)) wanted.set(key, mark.catalogId);
  }
  const out: Mark[] = [];
  const emitted = new Set<string>();
  for (const mark of marks) {
    const key = cellKey(mark.x, mark.y);
    if (emitted.has(key)) continue;
    const r = reflect(m, mark.x, mark.y);
    const rKey = cellKey(r.x, r.y);
    if (rKey === key) {
      if (!canPlant(mark.x, mark.y)) continue;
      emitted.add(key);
      out.push(mark);
      continue;
    }
    const other = wanted.get(rKey);
    if (other !== undefined && other !== mark.catalogId) continue;
    if (!canPlant(mark.x, mark.y) || !canPlant(r.x, r.y)) continue;
    emitted.add(key);
    emitted.add(rKey);
    out.push(mark, { x: r.x, y: r.y, catalogId: mark.catalogId });
  }
  return out;
}

/** Whether this region is composed formally (mirrored) at all. `share` is the rate over a batch,
 *  about two thirds, so the generator aims at a band rather than at every region. */
export function composesFormally(rng: Rng, share: number): boolean {
  return rng.float() < share;
}
