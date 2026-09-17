// src/io/export/canvas-limits.ts
// What THIS device's 2D canvas can allocate, measured once instead of assumed.
//
// `CANVAS_LIMITS` is desktop Chrome's ceiling: 16384 px per side and 16384² pixels of area. WebKit
// allows about a sixteenth of that area, so a 169×140 map composed at Size = Original asks for
// ~10848×9838 px and comes back blank, or takes the tab down with it. The export composes against
// the measured ceiling instead, and a desktop that confirms the constants keeps every pixel.
import { CANVAS_LIMITS, type CanvasLimits } from './sizing';

/** Candidate longest sides and area sides, largest first: the first one a device confirms is its
 *  answer. The rungs are the ceilings engines actually ship, so the ladder is three probes deep. */
const DIM_RUNGS = [16384, 8192, 4096];
const AREA_SIDE_RUNGS = [16384, 8192, 4096];

/** Allocate a canvas that size and confirm it can be drawn to and read back. A browser past its
 *  ceiling keeps the element but leaves the backing store unusable, so only the round trip answers;
 *  the far corner is the pixel that tells a silently clamped canvas from an honest one. The backing
 *  store is released immediately, so at most one probe's pixels are live at a time. */
function probeCanvas2d(w: number, h: number): boolean {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = w;
    canvas.height = h;
    if (canvas.width !== w || canvas.height !== h) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w - 1, h - 1, 1, 1);
    return ctx.getImageData(w - 1, h - 1, 1, 1).data[3] === 255;
  } catch {
    return false;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Descend both ladders through `probe`. A ladder that confirms nothing while the other confirms
 *  something takes its smallest rung, since the probe demonstrably ran; neither confirming means
 *  there is nothing to learn here (no 2D context at all) and the conservative constants stand. */
export function measureCanvasLimits(probe: (w: number, h: number) => boolean): CanvasLimits {
  const maxDim = DIM_RUNGS.find((d) => probe(d, 1));
  // A square wider than the longest side allowed cannot be allocated whatever the area ceiling is.
  const areaSide = AREA_SIDE_RUNGS.filter((s) => s <= (maxDim ?? Infinity)).find((s) => probe(s, s));
  if (maxDim === undefined && areaSide === undefined) return CANVAS_LIMITS;
  const side = areaSide ?? AREA_SIDE_RUNGS[AREA_SIDE_RUNGS.length - 1]!;
  return { maxDim: maxDim ?? DIM_RUNGS[DIM_RUNGS.length - 1]!, maxArea: side * side };
}

let measured: CanvasLimits | null = null;

/** Harness seam: stand in a ceiling, or null to measure again. */
export function __setDeviceCanvasLimits(limits: CanvasLimits | null): void {
  measured = limits;
}

/** This device's ceiling, measured on first use and kept: the probe allocates real pixels, and the
 *  answer cannot change within a session. */
export function deviceCanvasLimits(): CanvasLimits {
  if (measured) return measured;
  measured = typeof document === 'undefined' ? CANVAS_LIMITS : measureCanvasLimits(probeCanvas2d);
  return measured;
}
