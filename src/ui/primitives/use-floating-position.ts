import { type CSSProperties, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { viewportSize } from '../../platform/device/viewport-space';
import { visualRect } from '../design/visual-rect';
import { placeFloating, type FloatingPlacement } from './floating-position';

/** Whether two placements would draw the card identically: the per-frame follow compares every
 *  frame, so this is a field walk rather than a serialisation. */
function samePlacement(a: FloatingPlacement, b: FloatingPlacement): boolean {
  if (a.above !== b.above || a.anchorX !== b.anchorX || a.room !== b.room || a.anchorWidth !== b.anchorWidth) return false;
  const ka = Object.keys(a.box) as (keyof CSSProperties)[];
  if (ka.length !== Object.keys(b.box).length) return false;
  return ka.every((k) => a.box[k] === b.box[k]);
}

export type FloatingTarget = RefObject<HTMLElement | null> | { x: number; y: number };

export function useFloatingPosition({ open, anchor, zoom, width, maxHeight = Infinity, gap = 0, align = 'start', prefer = 'below', lockSide = false }: {
  open: boolean;
  anchor: FloatingTarget;
  zoom: number;
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);
  const options = useRef({ anchor, zoom, width, maxHeight, gap, align, prefer, lockSide });
  options.current = { anchor, zoom, width, maxHeight, gap, align, prefer, lockSide };
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    let side: 'above' | 'below' | undefined;
    const measure = () => {
      const card = ref.current;
      const { anchor, zoom, width, maxHeight, gap, align, prefer, lockSide } = options.current;
      const target = 'current' in anchor ? anchor.current : null;
      if (card && (!('current' in anchor) || target)) {
        const point = anchor as { x: number; y: number };
        const rect = target ? visualRect(target) : { left: point.x, right: point.x, top: point.y, bottom: point.y, width: 0, height: 0 };
        const next = placeFloating({ anchor: rect, zoom, width: width === 'anchor' ? rect.width / zoom : width ?? card.offsetWidth,
          height: card.scrollHeight + card.offsetHeight - card.clientHeight, viewport: viewportSize(), maxHeight, gap: typeof gap === 'function' ? gap(rect) : gap, align, prefer,
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
        setPlacement((current) => (current && samePlacement(current, next) ? current : next));
      }
      // Element anchors can move through transforms without a resize or scroll event.
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return { ref, placement, style: (placement?.box ?? { position: 'fixed' as const, left: -10000, top: 0 }) as CSSProperties };
}
