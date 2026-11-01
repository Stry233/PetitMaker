/** The shelves' backing: a band across the window's foot that cards stand up out of (`units.ts:PLATE_BAND`),
 *  as tall as the frame's plan makes it (`frame-plan.ts:FrameLayout.bar`) from its container's foot. */
import { useEffect, useRef, type CSSProperties } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { cssMotion, seconds } from '../../design/motion';
import { visualRect } from '../../design/visual-rect';
import { radii } from '../../design/styles';
import { DARK_PLATE, INSET, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE } from '../../design/tokens';
import { useFrameLayout, usePlanGlide } from '../frame-layout';
import { useMorph } from '../../primitives/morph';
import { LANDSCAPE_BAR } from '../frame-plan';
import { PLATE_BAND } from '../units';

/** The root custom property by which a held handle grows or shrinks the upright band past React, in
 *  frame px; its owner clears it as the hold ends (`controls/ModeRow.tsx`). */
export const BAR_PANEL_DRAG_VAR = '--bar-panel-drag';

/** Marks the upright bar's band, whose top edge the panels standing on it clip to while it moves. */
const BAR_BAND_ATTR = 'data-bar-band';

/** Marks a panel standing on the upright band (`bar-panel.tsx:useBarSurface`'s root). */
const BAR_PANEL_SELECTOR = '[data-bar-panel]';

/** How long past its declared glide a clip waits for the band before it lets the panel show whole. */
const CLIP_GRACE_MS = 600;

/** How far the clip stands out past a panel's sides and foot, so only the band's moving top edge cuts
 *  anything: rings and plates that bleed past the panel's box elsewhere stay whole. */
const CLIP_OUTSET = 48;

const clipping = new WeakMap<HTMLElement, () => void>();

/**
 * Clips `root`, a panel standing on the upright band, at the band's top edge on every frame while the
 * band glides (`shell.bar.expand`), growing or shrinking, so what the panel holds, still arriving or
 * leaving, never stands over the map past the band. A held WAAPI effect, so it applies from this
 * frame's paint and outranks the inline clip Framer keeps for a panel's rise; let go once the band no
 * longer glides and the grace a band that never starts waits is past, so nothing is clipped at rest. Callers skip it under reduced motion, where the
 * band steps.
 */
export function clipToBand(root: HTMLElement): void {
  if (typeof root.animate !== 'function') return;
  const band = document.querySelector<HTMLElement>(`[${BAR_BAND_ATTR}]`);
  if (!band) return;
  clipping.get(root)?.();
  const clipAt = (top: number) => {
    const at = `inset(${top}px -${CLIP_OUTSET}px -${CLIP_OUTSET}px -${CLIP_OUTSET}px)`;
    return [{ clipPath: at }, { clipPath: at }];
  };
  const span = seconds('shell.bar.expand') * 1000;
  const held = root.animate(clipAt(-CLIP_OUTSET), { duration: span, fill: 'forwards' });
  const until = performance.now() + span + CLIP_GRACE_MS;
  let frame = 0;
  const stop = () => { cancelAnimationFrame(frame); held.cancel(); if (clipping.get(root) === stop) clipping.delete(root); };
  clipping.set(root, stop);
  const follow = () => {
    const gliding = band.getAnimations().some((animation) => animation.playState === 'running');
    if (!root.isConnected || !band.isConnected || (performance.now() > until && !gliding)) { stop(); return; }
    const box = visualRect(root);
    const scale = root.offsetHeight > 0 ? box.height / root.offsetHeight : 1;
    const above = (visualRect(band).top - box.top) / scale;
    if (held.effect instanceof KeyframeEffect) held.effect.setKeyframes(clipAt(above > 0.5 ? above : -CLIP_OUTSET));
    frame = requestAnimationFrame(follow);
  };
  follow();
}

/** Starts the clip on every panel on the band as the band's height starts to glide. */
function clipTenants(e: TransitionEvent): void {
  if (e.target !== e.currentTarget || e.propertyName !== 'height') return;
  for (const root of document.querySelectorAll<HTMLElement>(BAR_PANEL_SELECTOR)) clipToBand(root);
}

/**
 * `tone` is the shelves' dark plate or the cream the upright mode bar stands on; `height` overrides the
 * plan's shelf band, and a change of it glides as the bar's one surface. `upright` draws the upright
 * bar's shape: window wide, square at the foot, its top corners rounded and edged like a card. `bare`
 * draws no fill or edge and lets presses through to the map, so the band fades in and out in place.
 * `morph` names it as a piece of the chrome's morph, which takes it box to box: a band holds nothing
 * that could stretch.
 */
export function ShelfBand({ tone = 'dark', height, upright = false, bare = false, glide = true, testId = 'bar-plate', morph }: {
  tone?: 'dark' | 'cream'; height?: number; upright?: boolean; bare?: boolean; morph?: string;
  /** False while the height follows a finger, which it then takes at once, `BAR_PANEL_DRAG_VAR` added. */
  glide?: boolean;
  testId?: string;
}) {
  const bar = useFrameLayout()?.bar ?? LANDSCAPE_BAR;
  const grow = usePlanGlide('shell.bar.expand');
  const reduced = useReducedMotionConfig() === true;
  const ref = useRef<HTMLSpanElement>(null);
  // A native listener: the band's glide starting is what every panel on it clips to.
  useEffect(() => {
    const band = ref.current;
    if (!upright || reduced || !band) return undefined;
    band.addEventListener('transitionrun', clipTenants);
    return () => band.removeEventListener('transitionrun', clipTenants);
  }, [upright, reduced]);
  const h = height ?? bar.height;
  const piece = useMorph(morph ?? '', 'fill');
  const shape: CSSProperties = upright
    ? {
      left: 0, right: 0, bottom: 0, height: glide ? h : `calc(${h}px + var(${BAR_PANEL_DRAG_VAR}, 0px))`, borderRadius: `${radii.lg}px ${radii.lg}px 0 0`,
      borderTop: bare ? `${PANEL_EDGE_WIDTH}px solid transparent` : PANEL_EDGE,
      // Under a frame zoom below 1, Chromium (seen in headless 156 on SwiftShader) leaves the old top
      // corners' edge painted where the band has grown past them, a seam across the open panel; a
      // layer of its own repaints whole.
      willChange: 'transform',
    }
    : { left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang, bottom: -PLATE_BAND.radius, height: h + PLATE_BAND.radius, borderRadius: PLATE_BAND.radius };
  return (
    <span
      data-testid={testId}
      ref={ref}
      {...(morph ? piece : {})}
      {...(upright ? { [BAR_BAND_ATTR]: '' } : {})}
      style={{
        position: 'absolute', boxSizing: 'border-box', ...shape,
        // The upright cream band sits a step down the ramp, so the button plates standing on it read.
        background: bare ? 'transparent' : tone === 'dark' ? DARK_PLATE : upright ? INSET : PLATE,
        // A height the window's size alone re-planned is taken at once, as the rest of the frame is.
        transition: [grow(glide ? ['height'] : []), cssMotion('shell.bar.expand', ['background-color', 'border-top-color'])].filter(Boolean).join(', '),
        // Solid: the shelf root lets the map through around it, but a press or drag on the band is the shelf's.
        pointerEvents: bare ? 'none' : 'auto',
      }}
    />
  );
}
