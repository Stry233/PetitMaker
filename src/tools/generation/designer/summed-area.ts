/** Summed-area tables over a 0/1 mask, so any rectangle's count is four reads. */
import { flatIndex, type Rect } from '../../../core/grid/rect';

/** Prefix sums over `mask`, `(W+1) x (H+1)`; a nonzero cell counts one. */
export function summedArea(mask: Uint8Array, W: number, H: number): Int32Array {
  const stride = W + 1;
  const out = new Int32Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += mask[flatIndex(x, y, W)] ? 1 : 0;
      out[(y + 1) * stride + x + 1] = out[y * stride + x + 1]! + row;
    }
  }
  return out;
}

/** How many counted cells `r` holds, read off a table from `summedArea` over a map `W` wide. */
export function rectSum(sat: Int32Array, W: number, r: Rect): number {
  const stride = W + 1;
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  return sat[y1 * stride + x1]! - sat[y0 * stride + x1]! - sat[y1 * stride + x0]! + sat[y0 * stride + x0]!;
}
