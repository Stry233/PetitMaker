/** The smoothstep-weighted bilinear blend of the lattice values `at` gives around (x, y): the
 *  interpolation every value-noise field in the app shares, whatever its lattice. */
export function smoothLattice(at: (ix: number, iy: number) => number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/** Seeded, smooth hash value noise in [0,1] over `smoothLattice`. A caller that needs a signed field
 *  remaps it to [-1,1]. */
export function valueNoise01(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 0x9e3779b9) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number): number => smoothLattice(hash, x, y);
}
