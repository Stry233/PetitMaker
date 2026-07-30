/*
 * panel-utils.ts — small style-helper factories shared by the v2 spoke panels.
 * Each panel converts PSD design-px to screen-px via usePx(); these factories
 * close over that px/pxf so the identical `box`/`ctext`/`iconImg` helpers aren't
 * re-declared inline in every panel. Usage: `const box = makeBox(px)`.
 */
import type { CSSProperties } from 'react';
import { colors, font, outlineShadow } from '../styles';

type Px = (n: number) => number;
type Fw = (w: number) => number;

/** Absolutely-positioned rect at PSD (x, y, w, h). */
export function makeBox(px: Px) {
  return (x: number, y: number, w: number, h: number): CSSProperties => ({
    position: 'absolute', left: px(x), top: px(y), width: px(w), height: px(h),
  });
}

/** Text centered on a PSD ink-bbox center (cx, cy) — matches the PSD exactly.
 *  fw is the scale-aware font-weight resolver from usePx(); pass it so CJK
 *  stroke fusion is avoided at low effective resolution. */
export function makeCtext(px: Px, pxf: Px, fw: Fw = (w) => w) {
  return (cx: number, cy: number, size: number, color: string): CSSProperties => ({
    position: 'absolute', left: px(cx), top: px(cy), transform: 'translate(-50%, -50%)',
    fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(size), color, lineHeight: 1,
    whiteSpace: 'nowrap', textAlign: 'center', userSelect: 'none', pointerEvents: 'none',
  });
}

/** Outlined submenu title: left-anchored (lx = left edge, so the icon→title gap
 *  stays constant across titles/languages), vertically centered, with an 8px
 *  white OUTER stroke behind the fill (a PSD layer effect). Shared by the Build /
 *  Placement / Generate spoke titles. `fw` is passed SEPARATELY (not baked from a
 *  single usePx()) because Generate deliberately keys the heavy-weight cap off its
 *  OUTER scale (fw, not ifw): its title renders at the same on-screen size as the
 *  other spokes' titles, so keying off `inner` would over-cap it to 600 and make
 *  it look thin. */
export function makeOutlinedTitle(px: Px, pxf: Px, fw: Fw) {
  return (x: number, y: number, size: number, color: string = colors.frameDark): CSSProperties => ({
    position: 'absolute', left: px(x), top: px(y), transform: 'translateY(-50%)',
    fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(size), color, lineHeight: 1,
    whiteSpace: 'nowrap', textShadow: outlineShadow(px(8), colors.white),
    pointerEvents: 'none', userSelect: 'none',
  });
}

/** Absolutely-positioned contain-fit image at PSD (x, y, w, h). */
export function makeIconImg(px: Px) {
  return (x: number, y: number, w: number, h: number): CSSProperties => ({
    position: 'absolute', left: px(x), top: px(y), width: px(w), height: px(h),
    objectFit: 'contain', pointerEvents: 'none',
  });
}

