/*
 * The Help Center's frame around a live component: no pointer events, `inert`, `contain: paint` (so fixed
 * descendants land inside it), and the pictured context (`UiPreviewProvider`), which surfaces that portal,
 * listen globally or keep singletons consult to hold still. `zoom` fits surfaces wider than the column.
 */
import type { CSSProperties, ReactNode } from 'react';
import { UiPreviewProvider, type UiPreviewPose } from '../../../design/preview';
import { radii } from '../../../design/styles';
import { useFigureReady } from '../figure-ready';

// React 18 has no typed `inert` prop; the empty-string spread is the codebase's idiom for it.
/** Spread onto a pictured subtree: it takes no focus and no input. */
export const INERT = { inert: '' } as const;

interface PreviewFrameProps {
  width?: number | string;
  height: number;
  /** CSS zoom applied to the mounted surface, for components wider than the frame. */
  zoom?: number;
  /** Where the surface anchors when it is taller than the frame ('top' crops the bottom). */
  align?: 'center' | 'top';
  /** Hug the surface instead of boxing it: `height` becomes a ceiling and the frame takes the
   *  mounted component's own height, so figures of one family carry identical slack (none). */
  fit?: boolean;
  /** The picture's pose, for a figure whose subject only stands in one (an open list, an armed
   *  mode). Absent, the subtree is pictured at rest. A figure that provides its own inner
   *  `UiPreviewProvider` keeps it: the nearer provider wins. */
  pose?: UiPreviewPose;
  style?: CSSProperties;
  children: ReactNode;
}

export function PreviewFrame({ width = '100%', height, zoom = 1, align = 'center', fit = false, pose, style, children }: PreviewFrameProps) {
  const ready = useFigureReady();
  return (
    <div
      aria-hidden
      {...INERT}
      style={{
        position: 'relative',
        width,
        ...(fit ? { maxHeight: height } : { height }),
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
      {/* Content-sized figures keep their children so section anchors do not shift on admission. */}
      {(ready || fit) && <div
        style={{
          ...(fit ? { position: 'relative' } : { position: 'absolute', inset: 0 }),
          zoom,
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
