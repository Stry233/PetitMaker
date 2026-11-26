/**
 * The export's 3D shots: the one to five camera angles its menu holds, the add, delete and replace
 * rules over them, and the content-aware set a map seeds them with.
 */
import type { CameraAngle } from './view-camera';
import type { GridState } from '../core/model/types';
import { clamp as clampN, lerp } from '../core/base/math';
import { FNV_BASIS, fnv1aStep } from '../core/base/hash';
import { ELEVATION_MAX } from '../core/game/profile';

export const MIN_SHOTS = 1;
export const MAX_SHOTS = 5;

/** The default block set: the four best smart angles. */
function seedShots(state: GridState): CameraAngle[] {
  return buildSmartAngles(state).slice(0, 4);
}

/** Each map's seeded set, kept so a list that holds none reads as the same shots every time. */
const SEEDED = new WeakMap<GridState, CameraAngle[]>();

/** The shots `stored` stands for on `state`'s map: its own, or the seeded set while it holds none. */
export function shotsOf(stored: CameraAngle[], state: GridState): CameraAngle[] {
  if (stored.length > 0) return stored;
  let seeded = SEEDED.get(state);
  if (!seeded) SEEDED.set(state, seeded = seedShots(state));
  return seeded;
}

const key = (a: CameraAngle): string => `${Math.round(a.az)},${Math.round(a.el)},${a.dist.toFixed(2)}`;

/** Append one more shot (a smart angle not already present, else a rotated variant of the last),
 *  capped at MAX_SHOTS. No-op at the cap. */
export function addShot(shots: CameraAngle[], state: GridState): CameraAngle[] {
  if (shots.length >= MAX_SHOTS) return shots;
  const seen = new Set(shots.map(key));
  const next = buildSmartAngles(state).find((a) => !seen.has(key(a)));
  const last = shots[shots.length - 1] ?? { az: 45, el: 45, dist: 0.9 };
  const fresh: CameraAngle = next ?? { ...last, az: last.az + 72 };
  return [...shots, fresh];
}

/** Remove the shot at index i, floored at MIN_SHOTS. No-op at the floor. */
export function deleteShot(shots: CameraAngle[], i: number): CameraAngle[] {
  if (shots.length <= MIN_SHOTS) return shots;
  return shots.filter((_, idx) => idx !== i);
}

/** Set the shot at index i (used by the angle editor's "Use this view"). */
export function replaceShot(shots: CameraAngle[], i: number, angle: CameraAngle): CameraAngle[] {
  return shots.map((s, idx) => (idx === i ? angle : s));
}

// The scene's OrbitControls polar limits (0.45..1.52 rad) bound elevation-from-horizon to ~3..64°;
// keep every derived tilt inside this so controls.update() never silently re-clamps a shot.
const EL_MIN = 6, EL_MAX = 63;

interface MassInfo { dx: number; dz: number; relief: number; peakDx: number; peakDz: number; spread: number }

/** Terrain shape summary in centered cell units (world X = column, Z = row):
 *  - dx/dz  : elevation-weighted mass centroid offset from center (which way the relief leans)
 *  - relief : 0 flat .. 1 at ELEVATION_MAX
 *  - peakDx/peakDz : the tallest cell's offset — the hero subject the bold shots frame
 *  - spread : how dispersed the high ground is (0 one tight massif .. 1 scattered), used to widen
 *             the orbit for busy maps and tighten it for a single landmark. */
function massInfo(state: GridState): MassInfo {
  const { cells, template } = state;
  const cx = template.width / 2, cy = template.height / 2;
  let sx = 0, sy = 0, sw = 0, maxE = 0, pkx = cx, pky = cy, sd = 0;
  for (let y = 0; y < template.height; y++) {
    const row = cells[y]; if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const e = row[x]?.terrain?.elevation ?? 0;
      if (e > 0) { sx += x * e; sy += y * e; sw += e; if (e > maxE) { maxE = e; pkx = x; pky = y; } }
    }
  }
  if (sw === 0) return { dx: 0, dz: 0, relief: 0, peakDx: 0, peakDz: 0, spread: 0 };
  const mx = sx / sw, my = sy / sw;
  // Second pass: elevation-weighted dispersion of high ground around its centroid (normalized by
  // the map's half-diagonal), a cheap "is the relief one massif or scattered?" signal.
  for (let y = 0; y < template.height; y++) {
    const row = cells[y]; if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const e = row[x]?.terrain?.elevation ?? 0;
      if (e > 0) sd += e * Math.hypot(x - mx, y - my);
    }
  }
  const halfDiag = Math.hypot(cx, cy) || 1;
  return { dx: mx - cx, dz: my - cy, relief: clampN(maxE / ELEVATION_MAX, 0, 1), peakDx: pkx - cx, peakDz: pky - cy, spread: clampN(sd / sw / halfDiag, 0, 1) };
}

/** Small deterministic hash of the map's shape → stable per-map angle variety (so the preview and
 *  the exported image frame identically, and two different maps rarely get the same set). */
function mapHash(state: GridState, m: MassInfo): number {
  let h = FNV_BASIS;
  const feed = (n: number) => { h = fnv1aStep(h, Math.round(n) & 0xffff); };
  feed(state.template.width); feed(state.template.height);
  feed(m.relief * 97); feed(m.peakDx * 13 + m.peakDz * 29); feed(m.spread * 131);
  return h >>> 0;
}

/** Content-aware, relief-adaptive angle set. It orbits the tallest peak (the hero subject) from
 *  four distinct sides with a dramatic tilt range: a low establishing hero, a high near-top
 *  overview that reads the layout, a
 *  bold low side, and a close 3/4 detail. Flatter maps tilt higher (layout), taller maps lower
 *  (drama); a busier relief (higher `spread`) widens the orbit. A per-map hash jitters the base
 *  azimuth, the orbit spacing, and the tilts so the framing feels authored per map rather than a
 *  formula — while staying fully deterministic (preview == export). Flat maps still get bold,
 *  varied shots (the base azimuth comes from the hash instead of the relief direction). */
export function buildSmartAngles(state: GridState): CameraAngle[] {
  const m = massInfo(state);
  const { template } = state;
  const maxDim = Math.max(template.width, template.height);
  const directional = Math.hypot(m.dx, m.dz) >= maxDim * 0.04;
  const h = mapHash(state, m);
  const pick = (shift: number, mod: number) => (h >>> shift) % mod;

  // Face the relief when there's a clear lean; else a per-map base so flat maps still vary.
  const faceAz = directional ? (Math.atan2(m.dx, m.dz) * 180) / Math.PI : pick(0, 360);
  const jitter = pick(7, 37) - 18;         // -18..+18° base rotation, per map
  const base = faceAz + 180 + jitter;      // camera sits opposite the mass, looking toward it

  // Bold, relief-adaptive tilt band: flat → higher (top-down layout), tall → lower (dramatic
  // relief), with a few degrees of per-map variation on each.
  const heroEl  = clampN(lerp(32, 21, m.relief) + pick(3, 6), EL_MIN, EL_MAX);   // low establishing
  const highEl  = clampN(lerp(61, 49, m.relief) - pick(5, 6), EL_MIN, EL_MAX);   // near top-down overview
  const closeEl = clampN(lerp(35, 24, m.relief) + pick(9, 5), EL_MIN, EL_MAX);   // bold low side
  const midEl   = clampN(lerp(46, 36, m.relief), EL_MIN, EL_MAX);                // close 3/4

  // Widen the orbit for scattered relief, tighten it around a lone landmark; jitter the spacing.
  const arc = lerp(78, 128, m.spread);
  const spin = pick(11, 19) - 9;

  // Frame the closer/side/hero shots on the tallest peak (bounded so they stay on the map).
  const tx = clampN(m.peakDx, -template.width * 0.34, template.width * 0.34);
  const tz = clampN(m.peakDz, -template.height * 0.34, template.height * 0.34);

  return [
    { az: base,                     el: heroEl,  dist: 1.05, tx, tz },  // hero — low, faces the relief
    { az: base + arc + spin,        el: highEl,  dist: 0.9 },           // high overview, a side over
    { az: base - arc - spin,        el: closeEl, dist: 0.6, tx, tz },   // bold low side on the peak
    { az: base + 2 * arc + spin,    el: midEl,   dist: 0.46, tx, tz },  // close 3/4 detail
  ];
}
