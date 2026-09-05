/*
 * spline.ts — the anchor-chain curve: a smooth path THROUGH every anchor, each with an adjustable
 * direction line.
 *
 * This is the curve the paint tools draw with and the one a route annotation runs along, so it
 * lives on the primitives floor where both the tool layer and the annotation model can reach it.
 * The cell-grid spine (rounding, 4-connected stitching) stays with the paint shapes; here is the
 * anchor algebra and the continuous sampling both spellings share.
 */

export interface CurveAnchor {
  x: number;
  y: number;
  /** Outgoing handle offset in cells. Absent = derived from the neighbours (see `anchorHandles`). */
  hx?: number;
  hy?: number;
  /** Incoming handle offset in cells. Absent = the mirror of the outgoing one, which is what makes
   *  the path smooth THROUGH the anchor; set independently, the two sides turn apart and the anchor
   *  becomes a corner. */
  ihx?: number;
  ihy?: number;
}

/** An anchor's two handle offsets, both measured FROM the anchor. */
export interface AnchorTangent {
  hx: number;
  hy: number;
  ihx: number;
  ihy: number;
}

/** Centripetal knot spacing: |Δp|^0.5. The floor keeps a repeated anchor from dividing by zero. */
function knots(a: readonly CurveAnchor[]): number[] {
  const t = [0];
  for (let i = 1; i < a.length; i++) {
    t.push(t[i - 1]! + Math.max(1e-4, Math.pow(Math.hypot(a[i]!.x - a[i - 1]!.x, a[i]!.y - a[i - 1]!.y), 0.5)));
  }
  return t;
}

/**
 * Each anchor's handle offset in cells — the user's where they set one, otherwise the one the
 * curve is actually using. The UI draws the direction lines from this, so an untouched anchor shows
 * the tangent the path already has rather than a straight stub that lies about it.
 *
 * The derived value is the non-uniform (centripetal) Catmull-Rom tangent, scaled by a third of the
 * outgoing knot span — the Bezier convention that makes `anchor + handle` a control point.
 */
export function anchorHandles(anchors: readonly CurveAnchor[]): AnchorTangent[] {
  const n = anchors.length;
  const t = knots(anchors);
  /** The incoming side mirrors the outgoing one unless it was set apart from it. */
  const both = (a: CurveAnchor, hx: number, hy: number): AnchorTangent => ({
    hx, hy,
    ihx: a.ihx !== undefined ? a.ihx : -hx,
    ihy: a.ihy !== undefined ? a.ihy : -hy,
  });
  return anchors.map((a, i) => {
    if (a.hx !== undefined && a.hy !== undefined) return both(a, a.hx, a.hy);
    if (n < 2) return both(a, 0, 0);
    const prev = anchors[Math.max(0, i - 1)]!;
    const next = anchors[Math.min(n - 1, i + 1)]!;
    const span = t[Math.min(n - 1, i + 1)]! - t[Math.max(0, i - 1)]!;
    // Scaled by the SHORTER adjacent span, not the outgoing one. The handle is symmetric — it is
    // the control point for the segment on either side — so sizing it from a long neighbour lets
    // that tangent overrun a short segment and swing the path back past its own anchor.
    const inSpan = i > 0 ? t[i]! - t[i - 1]! : Infinity;
    const outSpan = i < n - 1 ? t[i + 1]! - t[i]! : Infinity;
    const k = Math.min(inSpan, outSpan) / (3 * Math.max(1e-4, span));
    return both(a, (next.x - prev.x) * k, (next.y - prev.y) * k);
  });
}

/**
 * The continuous curve through the anchors, as float samples in cell units. Each segment is a
 * cubic Bezier out of one anchor's outgoing handle into the next one's incoming handle; with no
 * handles set those derive to centripetal Catmull-Rom, so an untouched chain is the familiar
 * smooth interpolation and an adjusted one bends exactly where its direction line says.
 *
 * `perSegment` fixes the sample count per anchor pair; absent, each segment gets enough steps for
 * its own length (two per cell, floored at eight).
 */
export function splineSamples(anchors: readonly CurveAnchor[], perSegment?: number): Array<[number, number]> {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [[anchors[0]!.x, anchors[0]!.y]];
  const h = anchorHandles(anchors);
  const out: Array<[number, number]> = [[anchors[0]!.x, anchors[0]!.y]];
  for (let i = 0; i < anchors.length - 1; i++) {
    const p0 = anchors[i]!, p1 = anchors[i + 1]!;
    const c0 = { x: p0.x + h[i]!.hx, y: p0.y + h[i]!.hy };
    const c1 = { x: p1.x + h[i + 1]!.ihx, y: p1.y + h[i + 1]!.ihy };
    const steps = perSegment ?? Math.max(8, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 2));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps, v = 1 - u;
      const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      out.push([
        p0.x * b0 + c0.x * b1 + c1.x * b2 + p1.x * b3,
        p0.y * b0 + c0.y * b1 + c1.y * b2 + p1.y * b3,
      ]);
    }
  }
  return out;
}
