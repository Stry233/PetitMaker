/*
 * sample-art.ts — the face a style direction wears before its real sample exists, and the one
 * ratio every picture box in this window is drawn at.
 *
 * The committed samples (`sample-assets.ts`) are generated from this project's own map, so they
 * ARE the direction. This painter is what stands in their place while an asset is absent: paper,
 * grain, three pencil strokes and the pack's own palette as a row of dabs. It says PALETTE and
 * nothing else on purpose — a fake little planet painted here would be a picture of a map the
 * provider never drew.
 */

/** The 2D share-image map band's own ratio. Every thumbnail, sample, card and canvas in this
 *  window is drawn at it, never stretched: a picture of the map at a different shape is a picture
 *  of a different map. */
export const MAP_ASPECT = 10848 / 8992;

export interface SampleArt {
  paper: string;
  palette: readonly string[];
}

/** A small deterministic source, so a card repaints identically at every render. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One hand-drawn line: a run of short segments each nudged off the straight, which is what reads
 *  as a stroke rather than as a rule. */
function wobbleLine(
  ctx: CanvasRenderingContext2D, x: number, y: number, len: number, amp: number, seed: number,
): void {
  const r = rng(seed);
  const steps = 14;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 1; i <= steps; i += 1) {
    ctx.lineTo(x + (len * i) / steps, y + (r() - 0.5) * 2 * amp);
  }
  ctx.stroke();
}

/**
 * Paints `art` into `canvas` at the map's ratio, sized from the element's own layout box and backed
 * at twice that, which is what keeps the strokes crisp on a 2x display.
 *
 * A box with no measured width has no picture to paint into: an unlaid-out canvas would take a
 * nominal size and then be drawn at the wrong scale the moment it got a real one.
 */
export function paintSampleArt(canvas: HTMLCanvasElement, art: SampleArt): void {
  const w = canvas.clientWidth;
  if (!w) return;
  const h = Math.round(w / MAP_ASPECT);
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(2, 0, 0, 2, 0, 0);

  ctx.fillStyle = art.paper;
  ctx.fillRect(0, 0, w, h);

  const grain = rng(11);
  ctx.fillStyle = 'rgba(87,73,53,0.05)';
  for (let i = 0; i < 60; i += 1) ctx.fillRect(grain() * w, grain() * h, 1.2, 1.2);

  ctx.strokeStyle = 'rgba(87,73,53,0.45)';
  ctx.lineWidth = Math.max(1.2, w * 0.014);
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k += 1) wobbleLine(ctx, w * 0.12, h * (0.3 + k * 0.18), w * (0.42 + k * 0.05), h * 0.03, 23 + k);

  const dabs = art.palette.slice(0, 4);
  const radius = Math.max(2.6, w * 0.032);
  dabs.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.24 + i * h * 0.17, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}
