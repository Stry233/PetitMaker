import type { GridState } from '../../core/model/types';
import { clamp as clampN, lerp } from '../../core/model/math';

/**
 * Best-effort offscreen 3D still for the export composition. Creates a throwaway
 * ThreeScene inside a container attached off-screen to document.body (so
 * clientWidth/clientHeight report the real requested size), renders one frame via
 * skipIntroAndRender(), captures a PNG, then disposes everything. Returns null on
 * ANY failure (no WebGL, build error, capture error) — export must never be
 * blocked by 3D.
 *
 * ThreeScene constructor: ThreeScene(container: HTMLElement, state: GridState)
 * It creates its own canvas and appends it to container. capture(), dispose(), and
 * skipIntroAndRender() are the relevant method names. The scene starts a RAF loop +
 * window listeners; dispose() shuts them all down.
 *
 * CAVEATS:
 * - Callers must NOT invoke this while a live Preview3D scene is open, because
 *   dispose() evicts the shared archetype and model caches. Sequential use only.
 * - jsdom has no WebGL: the WebGL probe returns null and the function returns null
 *   immediately (never throws, never imports three.js).
 */
export interface CameraAngle { az: number; el: number; dist: number; tx?: number; tz?: number }

/** Serialized identity of a CameraAngle — the cache/dedup key shared by the export shots menu's
 *  thumbnail cache and the preview's re-capture effect. */
export const angleKey = (a: CameraAngle): string =>
  `${a.az.toFixed(1)},${a.el.toFixed(1)},${a.dist.toFixed(2)},${a.tx ?? 0},${a.tz ?? 0}`;


/** Inverse of the scene's captureFromAngle position math: an offset vector (camera − target) plus
 *  the scene's base distance → a CameraAngle. tx/tz are the target's offset from the scene center.
 *  Used by ThreeScene.getCurrentAngle so the export 3D-shots editor can read back "Use this view". */
export function angleFromOffset(dx: number, dy: number, dz: number, baseDist: number, tx = 0, tz = 0): CameraAngle {
  const r = Math.hypot(dx, dy, dz) || 1e-6;
  const az = (Math.atan2(dx, dz) * 180) / Math.PI;
  const el = (Math.asin(clampN(dy / r, -1, 1)) * 180) / Math.PI;
  const dist = baseDist > 0 ? r / baseDist : 1;
  return { az, el, dist, tx, tz };
}

/** A world-space point — the three-free shape of THREE.Vector3, so the scene passes its camera and
 *  orbit-target vectors straight into the helpers below. */
export interface WorldPoint { x: number; y: number; z: number }

/** Offset from the orbit target to the camera's fly-in START pose, given its RESTING offset: 2.2x
 *  further out along the resting direction plus 0.4x the resting radius in height, so the map opens
 *  small in the fog. Magnitude is ~2.4x the resting radius — a distance no dolly clamp allows and no
 *  user can choose, which is what makes a mid-intro camera read (see reportedCameraAngle) wrong. */
export function introStartOffset(dx: number, dy: number, dz: number): WorldPoint {
  const r = Math.hypot(dx, dy, dz);
  const out = r > 0 ? 2.2 : 0;
  return { x: dx * out, y: dy * out + (r || 1) * 0.4, z: dz * out };
}

/** The camera pose to REPORT (io/autosave's 3D camera, the export editor's "use this view"): the
 *  live pose once the intro fly-in is done, the RESTING frame while it is still in flight. A camera
 *  can sit at the fly-in start indefinitely — pausing the hidden 3D view freezes the intro
 *  mid-flight — and the resting frame is where the fly-in is heading, so it is the pose the user is
 *  at. `rest*` are the scene's introTo/introTarget, which also define the unit of `dist`. */
export function reportedCameraAngle(
  cam: WorldPoint,
  target: WorldPoint,
  restCam: WorldPoint,
  restTarget: WorldPoint,
  introActive: boolean,
): CameraAngle {
  const c = introActive ? restCam : cam;
  const t = introActive ? restTarget : target;
  const baseDist = Math.hypot(restCam.x - restTarget.x, restCam.y - restTarget.y, restCam.z - restTarget.z);
  return angleFromOffset(c.x - t.x, c.y - t.y, c.z - t.z, baseDist, t.x - restTarget.x, t.z - restTarget.z);
}
// The scene's OrbitControls polar limits (0.45..1.52 rad) bound elevation-from-horizon to ~3..64°;
// keep every derived tilt inside this so controls.update() never silently re-clamps a shot.
const EL_MIN = 6, EL_MAX = 63;

interface MassInfo { dx: number; dz: number; relief: number; peakDx: number; peakDz: number; spread: number }

/** Terrain shape summary in centered cell units (world X = column, Z = row):
 *  - dx/dz  : elevation-weighted mass centroid offset from center (which way the relief leans)
 *  - relief : 0 flat .. 1 reaches the cap
 *  - peakDx/peakDz : the TALLEST cell's offset — the hero subject the bold shots frame
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
  return { dx: mx - cx, dz: my - cy, relief: clampN(maxE / 8, 0, 1), peakDx: pkx - cx, peakDz: pky - cy, spread: clampN(sd / sw / halfDiag, 0, 1) };
}

/** Small deterministic hash of the map's shape → stable per-map angle variety (so the preview and
 *  the exported image frame identically, and two different maps rarely get the same set). */
function mapHash(state: GridState, m: MassInfo): number {
  let h = 2166136261 >>> 0;
  const feed = (n: number) => { h = Math.imul(h ^ (Math.round(n) & 0xffff), 16777619) >>> 0; };
  feed(state.template.width); feed(state.template.height);
  feed(m.relief * 97); feed(m.peakDx * 13 + m.peakDz * 29); feed(m.spread * 131);
  return h >>> 0;
}

/** Content-aware, relief-adaptive angle set. It orbits the TALLEST peak (the hero subject) from
 *  four distinct sides with a dramatic tilt range: a low establishing hero, a high near-top
 *  overview that reads the layout, a
 *  bold low side, and a close 3/4 detail. Flatter maps tilt HIGHER (layout), taller maps LOWER
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
  const base = faceAz + 180 + jitter;      // camera sits OPPOSITE the mass, looking toward it

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

/** Capture several "smart angle" 3D stills from ONE throwaway scene (cheaper than N scenes).
 *  When `angles` is omitted, content-aware angles are derived from the map's relief.
 *  Returns one data URL per angle ('' for any that fail); [] if 3D/WebGL is unavailable. */
export async function captureMapStills(
  state: GridState,
  angles?: CameraAngle[],
  opts: { maxPx?: number; aspect?: number } = {},
): Promise<string[]> {
  try {
    if (typeof document === 'undefined') return [];
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') ?? probe.getContext('webgl'))) return [];
    const useAngles = angles ?? buildSmartAngles(state);
    const { ThreeScene } = await import('./scene/scene');
    const maxPx = opts.maxPx ?? 420;
    // `aspect` (width / height) lets callers request a landscape frame (the export 3D card's cell
    // shape) so the still needs no cropping to fill the card / menu tile. Defaults to square.
    const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
    const capW = maxPx, capH = Math.max(1, Math.round(maxPx / aspect));
    const container = document.createElement('div');
    container.style.cssText = `position:fixed; left:-99999px; top:0; width:${capW}px; height:${capH}px;`;
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    const scene = new ThreeScene(container, state);
    const urls: string[] = [];
    try {
      scene.skipIntroAndRender(); // settle to the resting frame first
      for (const a of useAngles) { try { urls.push(scene.captureFromAngle(a.az, a.el, a.dist, a.tx ?? 0, a.tz ?? 0) ?? ''); } catch { urls.push(''); } }
    } finally { scene.dispose(); if (container.parentNode) container.remove(); }
    return urls;
  } catch { return []; }
}
