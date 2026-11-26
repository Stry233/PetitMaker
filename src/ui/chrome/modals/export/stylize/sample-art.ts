/*
 * The stand-in a style direction wears while its committed sample is absent (paper, grain, three strokes
 * and the pack's palette as dabs: it shows the palette and nothing else), drawn at the samples' own
 * ratio; a picture of the open map takes that map's ratio instead.
 */
import { INK, rgbaOf } from '../../../../design/tokens';
import { STYLE_SAMPLE_ASPECT } from '../../../../../assets/style-sample-urls';
import { makeRng } from '../../../../../core/base/rng';


export interface SampleArt {
  paper: string;
  palette: readonly string[];
}

/** One hand-drawn line: a run of short segments each nudged off the straight, which is what reads
 *  as a stroke rather than as a rule. */
function wobbleLine(
  ctx: CanvasRenderingContext2D, from: { x: number; y: number }, len: number, amp: number, seed: number,
): void {
  const { x, y } = from;
  const r = makeRng(seed).float;
  const steps = 14;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 1; i <= steps; i += 1) {
    ctx.lineTo(x + (len * i) / steps, y + (r() - 0.5) * 2 * amp);
  }
  ctx.stroke();
}

/**
 * Paints `art` into `canvas` at the samples' ratio, sized from the element's own layout box and backed
 * at twice that, which is what keeps the strokes crisp on a 2x display.
 *
 * A box with no measured width has no picture to paint into: an unlaid-out canvas would take a
 * nominal size and then be drawn at the wrong scale the moment it got a real one.
 */
export function paintSampleArt(canvas: HTMLCanvasElement, art: SampleArt): void {
  const w = canvas.clientWidth;
  if (!w) return;
  const h = Math.round(w / STYLE_SAMPLE_ASPECT);
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(2, 0, 0, 2, 0, 0);

  ctx.fillStyle = art.paper;
  ctx.fillRect(0, 0, w, h);

  const grain = makeRng(11).float;
  ctx.fillStyle = rgbaOf(INK, 0.05);
  for (let i = 0; i < 60; i += 1) ctx.fillRect(grain() * w, grain() * h, 1.2, 1.2);

  ctx.strokeStyle = rgbaOf(INK, 0.45);
  ctx.lineWidth = Math.max(1.2, w * 0.014);
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k += 1) wobbleLine(ctx, { x: w * 0.12, y: h * (0.3 + k * 0.18) }, w * (0.42 + k * 0.05), h * 0.03, 23 + k);

  const dabs = art.palette.slice(0, 4);
  const radius = Math.max(2.6, w * 0.032);
  dabs.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.24 + i * h * 0.17, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}
