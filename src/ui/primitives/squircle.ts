/*
 * squircle.ts — rounded-rectangle paths with iOS-style corner smoothing.
 *
 * The design source's corners are circular arcs (best-fit exponent 2.0). A naive
 * superellipse "squircle" bulges past the circle and reads as a larger radius,
 * so instead we use the figma-squircle construction: the corner KEEPS a true
 * circular arc of the measured radius (so the radius matches the design exactly)
 * and only the JOIN into the straight edges is eased with cubic béziers. That
 * gives the smoother, continuous-curvature "bezier" look without changing the
 * radius. smoothing = 0 → a plain circular rounded rect.
 *
 * Ported from the public figma-squircle algorithm (MIT, phamfoo).
 */

const rad = (deg: number) => (deg * Math.PI) / 180;

interface CornerParams {
  a: number; b: number; c: number; d: number; p: number; arc: number; r: number;
}

function cornerParams(r: number, smoothing: number, budget: number): CornerParams {
  const p = Math.min((1 + smoothing) * r, budget);
  let angleAlpha: number, angleBeta: number;
  const limit = budget / (1 + smoothing);
  if (r <= limit) {
    angleBeta = 90 * (1 - smoothing);
    angleAlpha = 45 * smoothing;
  } else {
    const diffRatio = (r - limit) / (budget - limit);
    angleBeta = 90 * (1 - smoothing * (1 - diffRatio));
    angleAlpha = 45 * smoothing * (1 - diffRatio);
  }
  const angleTheta = (90 - angleBeta) / 2;
  const p3ToP4 = r * Math.tan(rad(angleTheta / 2));
  const arc = Math.sin(rad(angleBeta / 2)) * r * Math.SQRT2;
  const c = p3ToP4 * Math.cos(rad(angleAlpha));
  const d = c * Math.tan(rad(angleAlpha));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arc, r };
}

const n = (x: number) => x.toFixed(3);

/**
 * SVG path for a rounded rectangle with iOS-style corner smoothing.
 * @param w width (px)  @param h height (px)
 * @param radius corner radius (px, clamped to min(w,h)/2)
 * @param smoothing 0..1 (0 = circular; ~0.5 = subtle Apple smoothing)
 */
function squirclePath(w: number, h: number, radius: number, smoothing = 0.5): string {
  const budget = Math.min(w, h) / 2;
  const r = Math.max(0, Math.min(radius, budget));
  if (r <= 0.5) return `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
  const { a, b, c, d, p, arc } = cornerParams(r, smoothing, budget);
  return [
    `M ${n(w - p)} 0`,
    // top-right
    `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(arc)}`,
    `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)}`,
    `L ${n(w)} ${n(h - p)}`,
    // bottom-right
    `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(arc)}`,
    `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)}`,
    `L ${n(p)} ${n(h)}`,
    // bottom-left
    `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(-arc)}`,
    `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))}`,
    `L 0 ${n(p)}`,
    // top-left
    `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(-arc)}`,
    `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)}`,
    'Z',
  ].join(' ');
}

// squircleClip is a pure function of its box, but is called for ~20+ clipped
// elements (every menu tile, card, panel) on every React render. Memoize the
// path string — the (w,h,r,smoothing) inputs are a small discrete set (a few
// sizes × the quantized uiZoom levels), so this turns the per-render trig + path
// building into a Map lookup. Identical output.
const clipCache = new Map<string, string>();

/** Convenience: a clip-path value for the given box. */
export function squircleClip(w: number, h: number, radius: number, smoothing = 0.5): string {
  const key = `${w}|${h}|${radius}|${smoothing}`;
  let v = clipCache.get(key);
  if (v === undefined) {
    if (clipCache.size > 512) clipCache.clear(); // bound it (zoom sweeps create new sizes)
    v = `path('${squirclePath(w, h, radius, smoothing)}')`;
    clipCache.set(key, v);
  }
  return v;
}
