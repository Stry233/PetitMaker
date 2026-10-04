import { type CSSProperties, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { viewportSize } from '../../core/runtime/viewport-space';
import { visualRect } from '../design/visual-rect';
import { placeFloating, type FloatingPlacement } from './floating-position';

export type FloatingTarget = RefObject<HTMLElement | null> | { x: number; y: number };

export function useFloatingPosition({ open, anchor, zoom, width, maxHeight = Infinity, gap = 0, align = 'start', prefer = 'below' }: {
  open: boolean;
  anchor: FloatingTarget;
  zoom: number;
  /** Outer width in local pixels, or the element anchor's visual width. */
  width?: number | 'anchor';
  maxHeight?: number;
  gap?: number;
  align?: 'start' | 'center' | 'end';
  prefer?: 'above' | 'below';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);
  const options = useRef({ anchor, zoom, width, maxHeight, gap, align, prefer });
  options.current = { anchor, zoom, width, maxHeight, gap, align, prefer };
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      const card = ref.current;
      const { anchor, zoom, width, maxHeight, gap, align, prefer } = options.current;
      const target = 'current' in anchor ? anchor.current : null;
      if (card && (!('current' in anchor) || target)) {
        const rect = target ? visualRect(target) : { left: (anchor as { x: number }).x, right: (anchor as { x: number }).x, top: (anchor as { y: number }).y, bottom: (anchor as { y: number }).y, width: 0 };
        const next = placeFloating({ anchor: rect, zoom, width: width === 'anchor' ? rect.width / zoom : width ?? card.offsetWidth,
          height: card.scrollHeight + card.offsetHeight - card.clientHeight, viewport: viewportSize(), maxHeight, gap, align, prefer });
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
        setPlacement((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      }
      // Element anchors can move through transforms without a resize or scroll event.
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return { ref, placement, style: (placement?.box ?? { position: 'fixed' as const, left: -10000, top: 0 }) as CSSProperties };
}
