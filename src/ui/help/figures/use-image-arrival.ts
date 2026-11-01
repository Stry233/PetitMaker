/*
 * A picture standing in a Help figure fades in once it has decoded, on the figure's own fade, rather
 * than arriving at full opacity mid-loop (UI-62): the pictured interface mounts its images fresh, so
 * the decode the live editor has long done happens in front of the reader.
 */
import { useEffect, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { cssMotion } from '../../design/motion';

export function useImageArrival(ref: RefObject<HTMLElement | null>): void {
  const reduced = useReducedMotionConfig() === true;
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced || typeof MutationObserver === 'undefined') return undefined;
    const hold = (img: HTMLImageElement) => {
      // The pictured pointer swaps its own art once decoded (`demo-cursor.ts`).
      if (img.closest('[data-figure-pointer]') || (img.complete && img.naturalWidth > 0)) return;
      img.style.opacity = '0';
      const show = () => {
        img.style.transition = cssMotion('help.figure.fade', ['opacity']);
        img.style.opacity = '';
      };
      img.addEventListener('load', show, { once: true });
      img.addEventListener('error', show, { once: true });
    };
    root.querySelectorAll('img').forEach(hold);
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLImageElement) hold(node);
          else if (node instanceof HTMLElement) node.querySelectorAll('img').forEach(hold);
        }
        if (record.type === 'attributes' && record.target instanceof HTMLImageElement) hold(record.target);
      }
    });
    watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    return () => watch.disconnect();
  }, [ref, reduced]);
}
