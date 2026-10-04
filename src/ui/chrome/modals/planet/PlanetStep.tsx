/** One step of a planet window inside `AnimatePresence mode="popLayout"`: the steps crossfade, and
 *  the step leaving takes no input while it fades. */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { useMotion } from '../../../shell/motion/use-motion';

const stepStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 };

// popLayout measures the leaving step through its ref.
export const PlanetStep = forwardRef<HTMLDivElement, { children: ReactNode }>(function PlanetStep({ children }, ref) {
  const fade = useMotion('section.opacity');
  const present = useIsPresent();
  return (
    <motion.div ref={ref} data-testid="planet-step" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}
      {...(present ? {} : { inert: '', 'aria-hidden': true, 'data-leaving': '' })} style={stepStyle}>
      {children}
    </motion.div>
  );
});
