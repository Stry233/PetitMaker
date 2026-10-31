/** One view of a window that changes views inside `AnimatePresence mode="popLayout"`: the views
 *  crossfade, the leaving one stands out of the flow so the window glides to the new view's size,
 *  and it takes no input while it fades. */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { useTransition } from '../../design/motion/use-motion';

/** The attributes a view leaving inside `AnimatePresence` wears while it fades: it takes no input and
 *  assistive technology no longer reads it. Call inside the presence child. */
export function useLeavingView(): Record<string, unknown> {
  return useIsPresent() ? {} : { inert: '', 'aria-hidden': true, 'data-leaving': '' };
}

// popLayout measures the leaving view through its ref.
export const WindowStep = forwardRef<HTMLDivElement, { children: ReactNode; style?: CSSProperties; testId?: string; view?: string }>(
  function WindowStep({ children, style, testId, view }, ref) {
    const fade = useTransition('section.opacity');
    const leaving = useLeavingView();
    return (
      <motion.div ref={ref} data-testid={testId} data-view={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
        {...leaving} style={style}>
        {children}
      </motion.div>
    );
  },
);
