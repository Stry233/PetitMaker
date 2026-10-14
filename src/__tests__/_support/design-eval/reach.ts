/** What the anchor landmark can walk to over a pavement mask: the evaluation's arrival and junction readings. */
import { floodFrom } from '../../../core/grid/cell-sets';
import { mapGrid } from '../../../core/grid/rect';

/**
 * Cells the anchor landmark reaches over `mask`. The mask and the landmark's own footprint (`anchor`)
 * conduct, and a bridge or ramp footprint conducts through its whole 3x3, because a deck meets the
 * street at its ends without being 4-adjacent to it. Cells in `cut` conduct nothing, so a caller can ask what the
 * walk loses without them.
 */
export function anchorReach(
  mask: Uint8Array, anchor: Uint8Array, crossing: Uint8Array, { W, H }: { W: number; H: number },
  cut?: ReadonlySet<number> | null,
): Uint8Array {
  const conduct = new Uint8Array(W * H);
  const { inB, idx } = mapGrid(W, H);
  for (let i = 0; i < W * H; i++) if ((mask[i] || anchor[i]) && !cut?.has(i)) conduct[i] = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!crossing[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (inB(nx, ny) && !cut?.has(idx(nx, ny))) conduct[idx(nx, ny)] = 1;
        }
      }
    }
  }
  const seeds: number[] = [];
  for (let i = 0; i < W * H; i++) if (anchor[i] && conduct[i]) seeds.push(i);
  return floodFrom(seeds, (i) => conduct[i] === 1, W, H);
}
