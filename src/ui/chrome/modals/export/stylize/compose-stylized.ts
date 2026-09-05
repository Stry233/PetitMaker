// The stylized band swap draws the generated picture, grid, plan notes and any AI disclosure into
// one flat image, so preview and export can treat it like an ordinary captured map.
// The disclosure is embedded in the map image so optional export bands cannot remove it.
import { font } from '../../../../design/styles';

export function composeStylizedBaseMap(stylized: CanvasImageSource, ink: HTMLImageElement | null, aiTag: string, grid: HTMLImageElement | null = null): HTMLCanvasElement {
  const w = (stylized as { width?: number }).width ?? 0;
  const h = (stylized as { height?: number }).height ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(stylized, 0, 0, w, h);
  // The grid under the ink, as the editor stacks them: notes are written over the lines.
  if (grid) ctx.drawImage(grid, 0, 0, w, h);
  if (ink) ctx.drawImage(ink, 0, 0, w, h);
  drawAiWatermark(ctx, w, h, aiTag);
  return canvas;
}

/** A small translucent pill in the band's bottom-right corner, sized off the band's own width so
 *  it reads the same at any generation resolution and survives the composed export's downscale. */
function drawAiWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  if (!label) return;
  const S = w / 1000;
  const fontPx = 16 * S;
  ctx.font = `700 ${fontPx}px ${font.family}`;
  const padX = 10 * S;
  const pillH = 26 * S;
  const pillW = ctx.measureText(label).width + padX * 2;
  const margin = 14 * S;
  const x = w - margin - pillW;
  const y = h - margin - pillH;
  const r = pillH / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + pillW, y, x + pillW, y + pillH, r);
  ctx.arcTo(x + pillW, y + pillH, x, y + pillH, r);
  ctx.arcTo(x, y + pillH, x, y, r);
  ctx.arcTo(x, y, x + pillW, y, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(43,38,33,0.5)';
  ctx.fill();
  ctx.fillStyle = '#F7F3E8';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX, y + pillH / 2);
  ctx.textBaseline = 'alphabetic';
}
