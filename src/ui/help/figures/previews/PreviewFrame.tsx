/*
 * The Help Center's frame around a live component: no pointer events, `inert`, `contain: paint` (so fixed
 * descendants land inside it), and the pictured context (`UiPreviewProvider`), which surfaces that portal,
 * listen globally or keep singletons consult to hold still. The surface draws at its live size, shrunk
 * to the column by the figure rule (`figure-scale.ts`) and cropped about its centre past it.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { UiPreviewProvider, type UiPreviewPose } from '../../../design/preview';
import { radii } from '../../../design/styles';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useFigureReady } from '../figure-ready';
import { cutShare, useFigureRoom } from '../figure-scale';
import { useMapBackdrop } from './map-backdrop';

// React 18 has no typed `inert` prop; the empty-string spread is the codebase's idiom for it.
/** Spread onto a pictured subtree: it takes no focus and no input. */
export const INERT = { inert: '' } as const;

interface PreviewFrameProps {
  /** The frame's width at the surface's live size: a number of px, or a share of the column. */
  width?: number | string;
  /** The crop's height at the surface's live size, in px. */
  height: number;
  /** Where the surface anchors when it is taller than the frame ('top' crops the bottom). */
  align?: 'center' | 'top';
  /** Hug the surface instead of boxing it: `height` becomes a ceiling and the frame takes the
   *  mounted component's own height, so figures of one family carry identical slack (none). */
  fit?: boolean;
  /** The picture's pose, for a figure whose subject only stands in one (an open list, an armed
   *  mode). Absent, the subtree is pictured at rest. A figure that provides its own inner
   *  `UiPreviewProvider` keeps it: the nearer provider wins each fact it names. */
  pose?: UiPreviewPose;
  /** Stand the surface over the visitor's map, as a surface that lives over the map draws its
   *  names in the outline the map reads through. */
  onMap?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

export function PreviewFrame({ width = '100%', height, align = 'center', fit = false, pose, onMap = false, style, children }: PreviewFrameProps) {
  const ready = useFigureReady();
  const room = useFigureRoom();
  const innerRef = useRef<HTMLDivElement>(null);
  // The surface's own width, read in its own px whatever zoom it stands under.
  const [natural, setNatural] = useState(0);
  useObservedSize(() => innerRef.current?.firstElementChild as HTMLElement | undefined, ([el]) => {
    if (el) setNatural((was) => (Math.abs(was - el.scrollWidth) > 0.5 ? el.scrollWidth : was));
  }, []);
  const stated = typeof width === 'number' ? width : 0;
  const share = cutShare(room, Math.max(stated, natural));
  const frameWidth = typeof width === 'number' ? Math.min(room || Infinity, Math.round(width * share)) : width;
  const frameHeight = Math.round(height * share);
  return (
    <div
      aria-hidden
      data-figure-sized
      {...INERT}
      style={{
        position: 'relative',
        width: frameWidth,
        maxWidth: '100%',
        ...(fit ? { maxHeight: frameHeight } : { height: frameHeight }),
        overflow: 'hidden',
        contain: 'paint',
        // `contain: paint` alone does not reparent `position: fixed` descendants in Chrome; a
        // will-change on the transform property does, and draws nothing.
        willChange: 'transform',
        pointerEvents: 'none',
        userSelect: 'none',
        borderRadius: radii.md,
        ...style,
      }}
    >
      {onMap && <MapBehind />}
      {/* Content-sized figures keep their children so section anchors do not shift on admission. */}
      {(ready || fit) && <div
        ref={innerRef}
        style={{
          ...(fit ? { position: 'relative' } : { position: 'absolute', inset: 0 }),
          zoom: share,
          display: 'flex',
          alignItems: align === 'top' ? 'flex-start' : 'center',
          justifyContent: 'center',
        }}
      >
        <UiPreviewProvider {...(pose ? { pose } : {})}>{children}</UiPreviewProvider>
      </div>}
    </div>
  );
}

/** A live window, posed open, in a screen of `width` by `height` px that it centres itself in as it
 *  does over the editor: the figure shows the whole window at live size, its top kept where the
 *  column crops it. */
export function PicturedWindow({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <PreviewFrame width={width} height={height} align="top">
      <div style={{ position: 'relative', width, height }}>{children}</div>
    </PreviewFrame>
  );
}

function MapBehind() {
  const backdrop = useMapBackdrop(16 / 9);
  return backdrop
    ? <img src={backdrop} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    : null;
}
