/** Cuts the districts the finished network leaves and marks the ones a street serves. */
import { flatIndex, rectContains, indexBounds } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { labelComponents } from '../../../../core/grid/cell-sets';
import type { CompositionPlan } from '../composition/composition';
import type { Board } from './board';
import type { District } from './model';

/**
 * The partition: connected pieces of open land, cut by the streets, by the flights and by the plate
 * edges: the segmentation a finished map reads as, computed here on the plan.
 *
 * A district is served when a street or a flight the plaza reaches runs along it. That is what makes
 * the partition a town rather than a pattern: every block has a front on a street.
 */
export function cutDistricts(board: Board, composition: CompositionPlan): District[] {
  const N = board.W * board.H;
  const open = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!board.land[i] || board.paved[i] || board.reserved[i]) continue;
    const x = i % board.W, y = (i / board.W) | 0;
    if (!rectContains(board.hubArea, x, y)) open[i] = 1;
  }
  // A district is one tier: the walk never joins open cells across a step.
  const { labels, sizes } = labelComponents(open, board.W, board.H, false, (i, j) => board.tier[i] === board.tier[j]);
  const pieces: number[][] = Array.from({ length: sizes.length - 1 }, () => []);
  for (let i = 0; i < N; i++) if (labels[i]) pieces[labels[i]! - 1]!.push(i);
  const out: District[] = [];
  for (const cells of pieces) {
    const plate = composition.plateOf[cells[0]!]!;
    out.push({
      id: out.length, cells, rect: indexBounds(cells, board.W),
      tier: plate >= 0 ? composition.plates[plate]!.tier : 0,
      served: servedBy(board, cells),
    });
  }
  return out;
}

/** Does any of the district's cells stand beside pavement or a reserved flight corridor? */
function servedBy(board: Board, cells: readonly number[]): boolean {
  for (const i of cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
      const j = flatIndex(nx, ny, board.W);
      if (board.paved[j] || board.reserved[j]) return true;
    }
  }
  return false;
}
