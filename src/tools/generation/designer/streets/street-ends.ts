/**
 * WHERE A STREET ENDS, read off a pavement mask alone.
 *
 * Two callers need the same answer for different reasons and at different times. The evaluator asks
 * it of a FINISHED map, to judge whether every end arrives at something a walker would call arriving;
 * the sculptor asks it of the street plan, before a single road tile exists, so the water it cuts can
 * stand where a walk finishes. Both get it here, so the two cannot disagree about what an end is.
 *
 * An end FACE is a run of paved cells with nothing paved ahead of them: narrow enough to be a street
 * rather than a square, street behind it, nothing paved off either flank, and no pavement of its own
 * standing in front of it. The last test is what keeps a paved FIGURE from reading as a hedge of dead
 * ends — both references pave ornament as well as streets, and every notch of such a figure presents
 * a face with pavement three cells behind it.
 */

/** How deep the street behind a face must run, how wide a face may be, and how far ahead of one the
 *  reading looks for more of the same pavement. */
const TERMINUS_DEPTH = 3;
const TERMINUS_WIDE = 6;
const TERMINUS_AHEAD = 4;

const inside = (x: number, y: number, W: number, H: number): boolean =>
  x >= 0 && y >= 0 && x < W && y < H;

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Walks every street end of a pavement mask, calling back with its face (as flat indices) and the
 *  heading it faces. */
export function eachTerminus(
  paved: Uint8Array, W: number, H: number,
  visit: (face: number[], dx: number, dy: number) => void,
): void {
  for (const [dx, dy] of NB4) {
    // The perpendicular axis a face runs along.
    const px = dy, py = dx;
    const open = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!paved[i]) continue;
        const nx = x + dx, ny = y + dy;
        const ahead = inside(nx, ny, W, H) ? paved[ny * W + nx]! : 0;
        if (!ahead) open[i] = 1;
      }
    }
    const seen = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!open[i] || seen[i]) continue;
        // The maximal run of open cells along the perpendicular, walked from this end of it.
        if (inside(x - px, y - py, W, H) && open[(y - py) * W + (x - px)]) continue;
        const face: number[] = [];
        for (let k = 0; ; k++) {
          const cx = x + px * k, cy = y + py * k;
          if (!inside(cx, cy, W, H) || !open[cy * W + cx]) break;
          seen[cy * W + cx] = 1;
          face.push(cy * W + cx);
        }
        if (!isTerminus(paved, W, H, face, dx, dy, px, py)) continue;
        visit(face, dx, dy);
      }
    }
  }
}

function isTerminus(
  paved: Uint8Array, W: number, H: number, face: readonly number[],
  dx: number, dy: number, px: number, py: number,
): boolean {
  if (face.length === 0 || face.length > TERMINUS_WIDE) return false;
  for (const i of face) {
    const x = i % W, y = (i / W) | 0;
    for (let k = 1; k <= TERMINUS_DEPTH; k++) {
      const bx = x - dx * k, by = y - dy * k;
      if (!inside(bx, by, W, H) || !paved[by * W + bx]) return false;
    }
  }
  const first = face[0]!, last = face[face.length - 1]!;
  for (const [i, sign] of [[first, -1], [last, 1]] as const) {
    const x = (i % W) + px * sign, y = ((i / W) | 0) + py * sign;
    if (inside(x, y, W, H) && paved[y * W + x]) return false;
  }
  for (const i of face) {
    const fx = i % W, fy = (i / W) | 0;
    for (let k = 1; k <= TERMINUS_AHEAD; k++) {
      for (let across = -TERMINUS_AHEAD; across <= TERMINUS_AHEAD; across++) {
        const x = fx + dx * k + dy * across, y = fy + dy * k + dx * across;
        if (inside(x, y, W, H) && paved[y * W + x]) return false;
      }
    }
  }
  return true;
}
