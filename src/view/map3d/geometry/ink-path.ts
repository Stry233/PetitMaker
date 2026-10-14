/**
 * Pure path geometry for the 3D annotation ink: note points in world X/Z, densified and draped on
 * the terrain, and the mitred ribbon strips every outline, route and dimension line is drawn as.
 * No three.js; the layer wraps the arrays.
 */
import type { GridState } from '../../../core/model/types';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { cellCornerWorld } from './coords';
import { surfaceHeightAt } from './pick';

/** One geometry's worth of ribbon strips: interleaved x, y, z positions and triangle indices. */
export interface RibbonStrips {
  positions: number[];
  index: number[];
}

/** A note point on the map, in world X/Z. */
export function worldPt(state: GridState, x: number, y: number): [number, number] {
  const w = cellCornerWorld(x, y, state.template.width, state.template.height, PLACEMENT_GRID);
  return [w.x, w.z];
}

/** Points every `step` cells along a path — a drape's height is read per point, so a long straight
 *  edge sampled only at its ends would run its ribbon on a slope between two terraces instead of
 *  stepping with the ground, which is what read as the border fragmenting on complex terrain. */
export function densify(pts: ReadonlyArray<[number, number]>, step = 0.4): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Drape heights that read the ink's width, not just its centerline: at a cliff lip a centerline
 * sample leaves half the ribbon hanging across the wall at the lower height (or smearing down its
 * face), so each point takes the tallest ground under its cross-section — the ink rides the
 * terrain's silhouette the way a laid sticker would. `probes` are signed fractions of `halfW`
 * along the path's left-hand perpendicular (a zone loop's interior side); the route probes both.
 */
export function drapeHeights(
  state: GridState,
  pts: ReadonlyArray<[number, number]>,
  probes: readonly number[],
  halfW: number,
  lift: number,
): Array<[number, number, number]> {
  return pts.map(([x, z], i) => {
    const [qx, qz] = pts[Math.max(i - 1, 0)]!;
    const [px, pz] = pts[Math.min(i + 1, pts.length - 1)]!;
    const dx = px - qx, dz = pz - qz;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    let h = -Infinity;
    for (const k of probes) h = Math.max(h, surfaceHeightAt(state, x + nx * k, z + nz * k));
    return [x, h + lift, z];
  });
}

/** Keep the flat number above every terrain cell under its footprint, including cliff lips. */
export function labelPlaneHeight(state: GridState, x: number, z: number, width: number, height: number): number {
  const nx = Math.max(1, Math.ceil(width * 2)), nz = Math.max(1, Math.ceil(height * 2));
  let highest = -Infinity;
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
    highest = Math.max(highest, surfaceHeightAt(state, x - width / 2 + ix / nx * width, z - height / 2 + iz / nz * height));
  }
  return highest;
}

/**
 * Draped ribbon strips along sampled paths, `width` across in XZ, one strip per path (a dashed
 * line arrives already cut into runs by `dashRuns`). Joints share mitered vertices — the joint's across-vector is the mean of the
 * neighbouring segments' perpendiculars, scaled to keep the drawn width — so a bend is one
 * continuous surface instead of per-segment quads opening wedge gaps at every corner sample. Each
 * open run ends in a semicircular cap, the round line caps the 2D stroke draws, and a closed one
 * miters its seam like any other joint. Every path lands
 * in one geometry, so a zone's whole outline is one draw.
 */
export function ribbonStrips(
  paths: ReadonlyArray<ReadonlyArray<[number, number, number]>>,
  width: number,
): RibbonStrips | null {
  const half = width / 2;
  const positions: number[] = [];
  const index: number[] = [];
  const push = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const cap = (p: [number, number, number], dirX: number, dirZ: number): void => {
    // A fan over the half-disc past the run's end; its base chord is the strip's own end line.
    const a0 = Math.atan2(dirZ, dirX) - Math.PI / 2;
    const c = push(p[0], p[1], p[2]);
    let prev = -1;
    for (let i = 0; i <= 8; i++) {
      const ang = a0 + (Math.PI * i) / 8;
      const v = push(p[0] + Math.cos(ang) * half, p[1], p[2] + Math.sin(ang) * half);
      if (prev >= 0) index.push(c, prev, v);
      prev = v;
    }
  };
  const strip = (run: ReadonlyArray<[number, number, number]>): void => {
    if (run.length < 2) return;
    // Per-segment unit perpendiculars in XZ, skipping zero-length steps.
    const perps: Array<[number, number]> = [];
    for (let i = 1; i < run.length; i++) {
      const dx = run[i]![0] - run[i - 1]![0];
      const dz = run[i]![2] - run[i - 1]![2];
      const len = Math.hypot(dx, dz);
      perps.push(len < 1e-6 ? perps[perps.length - 1] ?? [0, 0] : [-dz / len, dx / len]);
    }
    const first = run[0]!, last = run[run.length - 1]!;
    // A closed path miters its seam from both of its neighbouring segments, so it has no joint.
    const closed = run.length > 2 && Math.hypot(first[0] - last[0], first[2] - last[2]) < 1e-6;
    let prevA = -1, prevB = -1;
    for (let i = 0; i < run.length; i++) {
      const seam = closed && (i === 0 || i === run.length - 1);
      const n1 = seam ? perps[perps.length - 1]! : perps[Math.max(0, i - 1)]!;
      const n2 = seam ? perps[0]! : perps[Math.min(perps.length - 1, i)]!;
      let mx = n1[0] + n2[0];
      let mz = n1[1] + n2[1];
      const mlen = Math.hypot(mx, mz);
      if (mlen < 1e-6) { mx = n2[0]; mz = n2[1]; } else { mx /= mlen; mz /= mlen; }
      // Widen the joint so the drawn width holds through the bend; clamped tight — the corner
      // sampling keeps real joints under a few degrees, so anything sharper is a degenerate
      // sample, and letting the miter chase it throws a barb off the border.
      const scale = half / Math.max(0.85, mx * n2[0] + mz * n2[1]);
      const p = run[i]!;
      const a = push(p[0] + mx * scale, p[1], p[2] + mz * scale);
      const b = push(p[0] - mx * scale, p[1], p[2] - mz * scale);
      if (prevA >= 0) index.push(prevA, a, prevB, prevB, a, b);
      prevA = a;
      prevB = b;
    }
    if (closed) return;
    const p0 = perps[0]!, pn = perps[perps.length - 1]!;
    cap(first, -p0[1], p0[0]);   // facing back along the first segment
    cap(last, pn[1], -pn[0]);    // facing on along the last segment
  };
  for (const pts of paths) strip(pts);
  return positions.length === 0 ? null : { positions, index };
}
