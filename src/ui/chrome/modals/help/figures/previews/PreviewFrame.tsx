/*
 * PreviewFrame.tsx — the Help Center's window onto a REAL component.
 *
 * A UI figure is the product's own surface mounted live, not a drawing of it: the frame provides
 * `ModalPreviewContext` (a `ModalShell` inside renders contained, passive, un-zoomed), kills every
 * interaction (`pointer-events: none` + `inert`, so no handler, focus trap or global listener can
 * arm), and establishes a containing block for `position: fixed` descendants (`contain: paint`),
 * so shell furniture that positions against the viewport lands inside the frame instead.
 *
 * It also marks the whole subtree PICTURED (`UiPreviewProvider`): `inert` and `pointer-events` are
 * properties of the real DOM tree, so anything a child mounts OUTSIDE it — a body-level portal, a
 * window listener, a module-level singleton — escapes the containment above and reaches the live
 * app. Chrome that does any of those consults `useUiPreview` and holds still instead.
 *
 * `zoom` is the fit knob — the interface's own scaling idiom — for surfaces wider than the page
 * column (the keyboard board, the export card).
 */
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { ModalPreviewContext } from '../../../../../primitives/ModalShell';
import { UiPreviewProvider, type UiPreviewPose } from '../../../../../primitives/ui-preview';
import { radii } from '../../../../../design/styles';
import { useFigureReady } from '../figure-ready';

// React 18 has no typed `inert` prop; the empty-string spread is the codebase's idiom for it.
const INERT = { inert: '' } as unknown as HTMLAttributes<HTMLDivElement>;

export interface PreviewFrameProps {
  width?: number | string;
  height: number;
  /** CSS zoom applied to the mounted surface, for components wider than the frame. */
  zoom?: number;
  /** Where the surface anchors when it is taller than the frame ('top' crops the bottom). */
  align?: 'center' | 'top';
  /** HUG the surface instead of boxing it: `height` becomes a ceiling and the frame takes the
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
        <ModalPreviewContext.Provider value>
          <UiPreviewProvider {...(pose ? { pose } : {})}>{children}</UiPreviewProvider>
        </ModalPreviewContext.Provider>
      </div>}
    </div>
  );
}
