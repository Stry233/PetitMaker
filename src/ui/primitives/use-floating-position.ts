import { type CSSProperties, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { cancelFrame, frame } from 'framer-motion';
import { viewportSize } from '../../platform/device/viewport-space';
import { scaleMovingNow } from '../design/scale';
import { visualRect } from '../design/visual-rect';
import { placeFloating, type FloatingPlacement } from './floating-position';
import { onMorph, onMorphLayout, useMorph, type MorphRun } from './morph';

/** Whether two placements would draw the card identically: the per-frame follow compares every
 *  frame, so this is a field walk rather than a serialisation. */
function samePlacement(a: FloatingPlacement, b: FloatingPlacement): boolean {
  if (a.above !== b.above || a.anchorX !== b.anchorX || a.room !== b.room || a.anchorWidth !== b.anchorWidth) return false;
  const ka = Object.keys(a.box) as (keyof CSSProperties)[];
  if (ka.length !== Object.keys(b.box).length) return false;
  return ka.every((k) => a.box[k] === b.box[k]);
}

/**
 * The rung of the surface that holds `el` on the page's stacking ladder: the `z-index` of its
 * outermost positioned ancestor that sets one, or 0 where none does (the frame's own flow). A layer
 * portalled to the body for a control inside a window stands over that window only above this rung.
 * A static flex or grid child with a z-index also forms a stacking context, and this skips it.
 */
function surfaceRung(el: Element | null): number {
  let rung = 0;
  for (let at = el; at && at !== document.body; at = at.parentElement) {
    const style = getComputedStyle(at);
    const index = Number.parseInt(style.zIndex, 10);
    if (style.position !== 'static' && Number.isFinite(index)) rung = index;
  }
  return rung;
}

/**
 * The css `zoom` everything above `el` draws it at: the product of each box's own `zoom`. An engine
 * that reports no computed zoom (one without the property, or jsdom) falls back to the inline one.
 */
export function anchorZoom(el: Element | null): number {
  let zoom = 1;
  for (let at = el; at; at = at.parentElement) {
    const own = getComputedStyle(at).zoom || (at as HTMLElement).style?.zoom || '';
    const factor = own.endsWith('%') ? parseFloat(own) / 100 : parseFloat(own);
    if (Number.isFinite(factor) && factor > 0) zoom *= factor;
  }
  return zoom;
}

export type FloatingTarget = RefObject<HTMLElement | null> | { x: number; y: number };

export function useFloatingPosition({ open, anchor, zoom, width, maxHeight = Infinity, gap = 0, align = 'start', prefer = 'below', lockSide = false, overlap = false }: {
  open: boolean;
  anchor: FloatingTarget;
  /** The card's css `zoom`; `'anchor'` reads it off an element anchor as the card is placed
   *  (`anchorZoom`), so the card draws at whatever surface its anchor stands in. */
  zoom: number | 'anchor';
  /** Outer width in local pixels, or the element anchor's visual width. */
  width?: number | 'anchor';
  maxHeight?: number;
  /** Space between anchor and card in the card's px, or a function of the anchor's visual box. */
  gap?: number | ((anchor: { width: number; height: number }) => number);
  align?: 'start' | 'center' | 'end';
  prefer?: 'above' | 'below';
  /** Keep the side the first placement chose for as long as the card stays open, so a card whose
   *  content grows lengthens away from its anchor instead of jumping to the other side. */
  lockSide?: boolean;
  /** Stand the card whole over its anchor where neither side holds it (`floating-position.ts`). */
  overlap?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const piece = useMorph(`floating-${useId()}`);
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);
  const [rung, setRung] = useState(0);
  const [readZoom, setReadZoom] = useState(1);
  const options = useRef({ anchor, zoom, width, maxHeight, gap, align, prefer, lockSide, overlap });
  options.current = { anchor, zoom, width, maxHeight, gap, align, prefer, lockSide, overlap };
  useLayoutEffect(() => {
    if (!open) return;
    let first = true;
    let side: 'above' | 'below' | undefined;
    let last: FloatingPlacement | null = null;
    let read: number | undefined;
    const held = options.current.anchor;
    setRung('current' in held ? surfaceRung(held.current) : 0);
    // The chrome's morph carries the card as one of its pieces: it is placed against the new
    // arrangement just before the morph measures where its pieces end, and not followed while the
    // morph draws its anchor there.
    let carried: MorphRun | null = null;
    const measure = (force = false) => {
      if (carried && !force) return;
      // Through a scale glide, a render this frame's writers asked for (the gliding zoom) lands first,
      // so the card is placed at the zoom it is drawn at; at rest nothing is forced.
      const gliding = !first && scaleMovingNow();
      if (gliding) flushSync(() => {});
      const card = ref.current;
      const { anchor, zoom: asked, width, maxHeight, gap, align, prefer, lockSide, overlap } = options.current;
      const target = 'current' in anchor ? anchor.current : null;
      // An anchor's zoom changes only with the scale or the chrome's morph, so it is read then, not every frame.
      if (asked === 'anchor' && (first || gliding || force || read === undefined)) { read = anchorZoom(target); setReadZoom(read); }
      const zoom = asked === 'anchor' ? read ?? 1 : asked;
      if (card && (!('current' in anchor) || target)) {
        const point = anchor as { x: number; y: number };
        const rect = target ? visualRect(target) : { left: point.x, right: point.x, top: point.y, bottom: point.y, width: 0, height: 0 };
        const next = placeFloating({ anchor: rect, zoom, width: width === 'anchor' ? rect.width / zoom : width ?? card.offsetWidth,
          height: card.scrollHeight + card.offsetHeight - card.clientHeight, viewport: viewportSize(), maxHeight, gap: typeof gap === 'function' ? gap(rect) : gap, align, prefer, overlap,
          ...(lockSide && side ? { side } : {}) });
        side ??= next.above ? 'above' : 'below';
        if (width === undefined) {
          // Preserve the caller's natural width so a viewport cap can shrink and later release it.
          const computed = getComputedStyle(card);
          const contentBox = computed.boxSizing !== 'border-box';
          const horizontal = contentBox ? parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight) + card.offsetWidth - card.clientWidth : 0;
          const vertical = contentBox ? parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom) + card.offsetHeight - card.clientHeight : 0;
          delete next.box.width;
          delete next.box.boxSizing;
          next.box.maxWidth = Math.max(0, Number(next.box.maxWidth) - horizontal);
          next.box.maxHeight = Math.max(0, Number(next.box.maxHeight) - vertical);
        }
        const place = () => setPlacement((current) => (current && samePlacement(current, next) ? current : next));
        const moved = !last || !samePlacement(last, next);
        last = next;
        // A move commits in the frame that moved the anchor (a UI-zoom glide, a sliding dock), so the
        // card never trails it by a frame; a frame that moved nothing commits nothing.
        if (first) place();
        else if (gliding || moved) flushSync(place);
      }
      first = false;
    };
    measure();
    // Element anchors can move through transforms without a resize or scroll event. Measured after
    // the frame's own writers (`frame.postRender`), so an anchor a per-frame writer moved is read
    // where this frame draws it.
    const follow = () => measure();
    frame.postRender(follow, true);
    const offRun = onMorph((run) => {
      carried = run;
      void run.settled.then(() => { if (carried === run) carried = null; });
    });
    const offLayout = onMorphLayout(() => measure(true));
    return () => { cancelFrame(follow); offRun(); offLayout(); };
  }, [open]);
  // `rung` is the stacking rung of the surface holding an element anchor (`surfaceRung`), read as the
  // card opens.
  // `piece` goes on the card beside `ref`: it marks the card as a piece of the chrome's morph.
  // `zoom` is the card's zoom: the one asked for, or the one read off the anchor.
  return { ref, piece, placement, rung, zoom: zoom === 'anchor' ? readZoom : zoom, style: (placement?.box ?? { position: 'fixed' as const, left: -10000, top: 0 }) as CSSProperties };
}
