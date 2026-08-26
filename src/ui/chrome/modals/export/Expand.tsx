import { type ReactNode, type HTMLAttributes } from 'react';
import { useReducedMotionConfig } from 'framer-motion';

/**
 * Expand — smoothly expands/collapses its children by animating a CSS grid row
 * from 0fr to 1fr. The row resolves to the EXACT content height every frame, so
 * there is no measure-then-snap on the final frame the way a framer
 * `height: 'auto'` tween has, which shows as a space jump on the last frame.
 * A gentle, slightly longer easeInOutCubic reads as a glide rather than a snap.
 *
 * Children stay mounted (so typed field values persist across a collapse); when
 * collapsed they're marked `inert` so keyboard focus skips the hidden controls.
 * Reduced motion snaps with no transition. Shared by the two export modals.
 */
const EXPAND_EASE = 'grid-template-rows 0.42s cubic-bezier(0.65, 0, 0.35, 1)';

export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotionConfig();
  // @types/react 18 has no `inert` prop yet; apply it as a raw attribute.
  const closedAttrs = open ? {} : ({ inert: '' } as unknown as HTMLAttributes<HTMLDivElement>);
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: reduced ? undefined : EXPAND_EASE }}>
      <div {...closedAttrs} style={{ overflow: 'hidden', minHeight: 0, opacity: open ? 1 : 0, transition: reduced ? undefined : 'opacity 0.3s ease' }}>
        {children}
      </div>
    </div>
  );
}
