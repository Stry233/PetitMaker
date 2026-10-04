import { forwardRef, useImperativeHandle, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { cssMotion } from '../design/motion';
import { PLATE } from '../design/tokens';
import { useScrollGeometry, type ScrollGeometry } from './scroll-geometry';
import { SCROLL_FADE, STOP_EPS } from './scroll-fade';

type ScrollGutter = 'auto' | 'stable' | 'stable both-edges';

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  gutter: ScrollGutter;
  contentStyle?: CSSProperties;
  viewportStyle?: CSSProperties;
  /** Pinned headings retain an opaque start edge; fades never mask the viewport or its scrollbar. */
  fade?: 'both' | 'end' | 'none';
  surface?: string;
  onGeometry?: (geometry: ScrollGeometry) => void;
}

/** The ref and native scroll/keyboard attributes belong to the viewport; style sizes the outer box. */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea({
  children, style, contentStyle, viewportStyle, gutter, fade = 'both', surface = PLATE, onGeometry, className, ...props
}, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => viewport.current!);
  const reduced = useReducedMotionConfig() === true;
  const [edges, setEdges] = useState({ start: false, end: false, width: 0, left: 0 });
  useScrollGeometry(viewport, (g) => {
    onGeometry?.(g);
    const next = { start: g.top > STOP_EPS, end: g.scrollHeight - g.top - g.height > STOP_EPS, width: g.width, left: g.insetLeft };
    setEdges(old => old.start === next.start && old.end === next.end && old.width === next.width && old.left === next.left ? old : next);
  });
  const shade: CSSProperties = {
    position: 'absolute', left: edges.left, width: edges.width || '100%', height: SCROLL_FADE,
    maxHeight: '25%', pointerEvents: 'none', transition: cssMotion('scroll.fade', ['opacity'], reduced),
  };
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, ...style }}>
      <div {...props} ref={viewport} data-scroll-viewport="" className={[className, gutter !== 'auto' && 'pw-scroll-stable', gutter === 'stable both-edges' && 'pw-scroll-balanced'].filter(Boolean).join(' ')}
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: gutter, overflowAnchor: 'none', ...viewportStyle }}>
        <div data-scroll-content="" style={{ display: 'flow-root', ...contentStyle }}>{children}</div>
      </div>
      {fade === 'both' && <div aria-hidden style={{ ...shade, top: 0, opacity: edges.start ? 1 : 0, background: `linear-gradient(to bottom, ${surface}, transparent)` }} />}
      {fade !== 'none' && <div aria-hidden style={{ ...shade, bottom: 0, opacity: edges.end ? 1 : 0, background: `linear-gradient(to top, ${surface}, transparent)` }} />}
    </div>
  );
});
