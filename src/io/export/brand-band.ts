/** The maker's band every export ends with: the locale's lockup and, where the deployment names a
 *  site, its address, an invitation and a QR code. */
import qrcode from 'qrcode-generator';
import type { Rect } from '../../core/grid/rect';
import { EXPORT_CARD, EXPORT_PAPER, FRAME_INK, rgbaOf } from '../../assets/brand-palette';
import { rrPath } from '../../view/shared/viewport/round-rect';
import { PAD } from './compose';
import type { Painter } from './paint';

/** Draw the app lockup and, when configured by the deployment, its address and QR code. */
export function drawBrand(p: Painter, rect: Rect, bare: boolean): void {
  const { ctx, assets, S, FF } = p;
  // Full-bleed exports add the inset that framed exports receive from their card padding.
  const inset = bare ? PAD * S : 0;
  const x0 = rect.x + inset, w = rect.w - 2 * inset;
  const padY = 8 * S;
  const contentH = rect.h - 2 * padY;
  const cy = rect.y + rect.h / 2;

  if (bare) {
    ctx.fillStyle = EXPORT_PAPER;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // An empty URL omits the QR and address text.
  const hasSite = assets.brand.url.length > 0;
  const qrSide = hasSite ? contentH : 0;
  const qrX = x0 + w - qrSide;
  if (hasSite) drawSiteQr(ctx, assets.brand.url, { x: qrX, y: rect.y + padY, w: qrSide, h: qrSide }, S);

  // Compensate for the transparent margins built into the lockup asset.
  const LOCKUP_OVERDRAW = 228 / 172;
  let lockupRight = x0;
  const art = assets.brand.lockup;
  const drawH = contentH * LOCKUP_OVERDRAW;
  const artW = art && 'width' in art && 'height' in art
    ? drawH * ((art.width as number) / (art.height as number)) : 0;
  if (art && artW > 0) {
    const padShareX = 28 / 796; // the art's own left margin, folded back so the mark starts at x0
    ctx.drawImage(art, x0 - artW * padShareX, cy - drawH / 2, artW, drawH);
    lockupRight = x0 + artW * (1 - 2 * padShareX);
  } else {
    ctx.fillStyle = FRAME_INK;
    ctx.font = `900 ${20 * S}px ${FF}`;
    ctx.fillText(assets.translate('app.name'), x0, cy + 7 * S);
    lockupRight = x0 + ctx.measureText(assets.translate('app.name')).width;
  }

  // Fit the address first, then the invitation when both fit beside the lockup.
  const textRight = hasSite ? qrX - 12 * S : x0 + w;
  const room = textRight - (lockupRight + 14 * S);
  ctx.textAlign = 'right';
  ctx.font = `800 ${14 * S}px ${FF}`;
  const labelW = ctx.measureText(assets.brand.label).width;
  ctx.font = `700 ${11 * S}px ${FF}`;
  const powerW = ctx.measureText(assets.brand.powerText).width;
  if (!hasSite) {
    // No site named: no words either. The band is the lockup alone.
  } else if (Math.max(labelW, powerW) <= room) {
    ctx.fillStyle = rgbaOf(FRAME_INK, 0.62);
    ctx.fillText(assets.brand.powerText, textRight, cy - 3 * S);
    ctx.fillStyle = FRAME_INK;
    ctx.font = `800 ${14 * S}px ${FF}`;
    ctx.fillText(assets.brand.label, textRight, cy + 14 * S);
  } else if (labelW <= room) {
    ctx.fillStyle = FRAME_INK;
    ctx.font = `800 ${14 * S}px ${FF}`;
    ctx.fillText(assets.brand.label, textRight, cy + 5 * S);
  }
  ctx.textAlign = 'left';
}

/** Draw an error-level-M QR code with one quiet-zone module on each side. */
function drawSiteQr(ctx: CanvasRenderingContext2D, url: string, square: Rect, S: number): void {
  const { x, y, w: side } = square;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const cell = side / (n + 2); // one quiet module each side
  ctx.fillStyle = EXPORT_CARD;
  rrPath(ctx, square, 6 * S);
  ctx.fill();
  ctx.fillStyle = FRAME_INK;
  const ox = x + cell, oy = y + cell;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      // Overdrawn a hair so adjacent modules fuse without antialias seams.
      ctx.fillRect(ox + c * cell, oy + r * cell, cell + 0.5, cell + 0.5);
    }
  }
}
