/**
 * A stencil turned clockwise a quarter turn at a time, so a Letter or Picture built in its own frame
 * (its top up) lands facing another map direction. Every per-cell layer moves with its cell; the
 * layers that name directions inside a cell (quadrant coverage, line exits) turn with it too.
 */
import type { Rotation } from '../../../core/model/types';
import type { Stencil } from '../recipe';
import { rotateExits } from '../../../core/grid/directions';
import type { StencilBox } from './stencil-raster';

/** The box a stencil facing `turn` is drawn in before it turns: `box` with its width and height
 *  traded across a quarter turn, so the turned stencil fills `box`. */
export function stencilFrame(box: StencilBox, turn: Rotation): StencilBox {
  return turn === 90 || turn === 270 ? { ...box, width: box.height, height: box.width } : box;
}

/** Where a cell's quadrants go under one clockwise quarter turn, in corner order [TL, TR, BL, BR]:
 *  TL to TR, TR to BR, BL to TL, BR to BL. */
const QUAD_TURN = [1, 3, 0, 2] as const;

/** `stencil` turned `turn` degrees clockwise; the stencil itself for no turn. */
export function turnStencil(stencil: Stencil, turn: Rotation): Stencil {
  let s = stencil;
  for (let q = 0; q < turn / 90; q++) s = quarterTurn(s);
  return s;
}

function quarterTurn(s: Stencil): Stencil {
  const { width: w, height: h } = s;
  // Cell (x, y) of a w-by-h stencil stands at (h - 1 - y, x) of the h-by-w one.
  const to = (i: number): number => (i % w) * h + (h - 1 - Math.floor(i / w));
  const move = <A extends Uint8Array | Uint32Array>(src: A, make: (n: number) => A): A => {
    const out = make(src.length);
    for (let i = 0; i < src.length; i++) out[to(i)] = src[i]!;
    return out;
  };
  const bytes = (n: number) => new Uint8Array(n);
  let quad: Uint8Array | undefined;
  if (s.quad) {
    quad = new Uint8Array(s.quad.length);
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 4; c++) quad[to(i) * 4 + QUAD_TURN[c]!] = s.quad[i * 4 + c]!;
    }
  }
  return {
    ...s,
    width: h,
    height: w,
    coverage: move(s.coverage, bytes),
    color: move(s.color, (n) => new Uint32Array(n)),
    ...(s.curves ? { curves: move(s.curves, bytes) } : {}),
    ...(s.connections ? { connections: move(s.connections, bytes).map((m) => rotateExits(m, 1)) } : {}),
    ...(quad ? { quad } : {}),
  };
}
