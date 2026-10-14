import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { amplitude } from '../../../design/motion';
import type { MotionId } from '../../../design/motion/registry';
import { useTransition } from '../../../design/motion/use-motion';

/** Departing content retains its space but cannot receive input while its replacement arrives. */
export function ContentSwap({ contentKey, children, motionId = 'shelf.category.swap', travel = false, style }: {
  contentKey: string | null;
  children: ReactNode;
  motionId?: MotionId;
  travel?: boolean;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotionConfig();
  const content = contentKey === null ? null : <SwapBody key={contentKey} motionId={motionId} travel={travel} style={style}>{children}</SwapBody>;
  return reduced ? content : <AnimatePresence initial={false} mode="wait">{content}</AnimatePresence>;
}

function SwapBody({ children, motionId, travel, style }: {
  children: ReactNode; motionId: MotionId; travel: boolean; style?: CSSProperties;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotionConfig();
  const transition = useTransition(motionId);
  const shift = travel && !reduced ? amplitude(motionId) : 0;
  return <motion.div data-content-swap aria-hidden={!present || undefined} {...(!present ? { inert: '' } : {})}
    initial={{ opacity: 0, x: shift }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -shift }} transition={transition}
    style={style}>{children}</motion.div>;
}
