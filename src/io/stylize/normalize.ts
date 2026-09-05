// Letterbox math: fits a captured map into a provider's nearest aspect frame, and the inverse
// crop that recovers the illustrated region once a provider hands back its own output size.

export interface AspectOption { id: string; ratio: number }

export interface NormalizePlan {
  frameW: number; frameH: number;   // letterboxed frame sent to the provider
  drawW: number; drawH: number;     // the map scaled to fit inside the frame
  offsetX: number; offsetY: number; // centering offsets
  aspectId: string;                 // which provider aspect was chosen
}

/** Picks the aspect nearest the source's own shape (orientation-aware: no ratio is inverted to
 *  compare), sizes the frame so its long edge is `maxEdge`, then fits the source inside it without
 *  ever upscaling — a source smaller than the frame shrinks the frame down to the source's own
 *  scale instead, so the frame's aspect is preserved but its absolute size is not inflated. */
export function planNormalize(
  srcW: number, srcH: number, maxEdge: number, aspects: readonly AspectOption[],
): NormalizePlan {
  const srcRatio = srcW / srcH;
  let best = aspects[0]!;
  let bestScore = Infinity;
  for (const a of aspects) {
    const score = Math.abs(Math.log(a.ratio / srcRatio));
    if (score < bestScore) { bestScore = score; best = a; }
  }

  let frameW = best.ratio >= 1 ? maxEdge : maxEdge * best.ratio;
  let frameH = best.ratio >= 1 ? maxEdge / best.ratio : maxEdge;

  const containScale = Math.min(frameW / srcW, frameH / srcH);
  const drawScale = Math.min(containScale, 1);
  if (containScale > 1) {
    frameW /= containScale;
    frameH /= containScale;
  }

  const drawW = srcW * drawScale;
  const drawH = srcH * drawScale;
  return {
    frameW, frameH, drawW, drawH,
    offsetX: (frameW - drawW) / 2,
    offsetY: (frameH - drawH) / 2,
    aspectId: best.id,
  };
}

/** Maps the plan's inner (letterbox-free) rect onto the provider's ACTUAL output size —
 *  providers return their own resolution, never exactly `frameW`x`frameH`, so the crop scales
 *  proportionally by `outW/frameW` rather than reusing the plan's pixel values directly. */
export function cropBackRect(
  plan: NormalizePlan, outW: number, outH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = outW / plan.frameW;
  void outH; // the provider is expected to honor the requested aspect; only one scale is needed
  return {
    x: plan.offsetX * scale,
    y: plan.offsetY * scale,
    w: plan.drawW * scale,
    h: plan.drawH * scale,
  };
}

/** Paints `img` onto a fresh canvas at the plan's frame size: `paper` fills the letterbox bars,
 *  then the source draws centered at its planned rect. No smoothing flags are touched here — the
 *  canvas's own default rules the resample. */
export function letterboxToCanvas(img: CanvasImageSource, plan: NormalizePlan, paper: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(plan.frameW);
  canvas.height = Math.round(plan.frameH);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, plan.frameW, plan.frameH);
  ctx.drawImage(img, plan.offsetX, plan.offsetY, plan.drawW, plan.drawH);
  return canvas;
}
