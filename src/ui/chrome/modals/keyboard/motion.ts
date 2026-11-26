import type { Variants } from 'framer-motion';
import { amplitude, framerMotion, staggerDelay } from '../../../design/motion';

/** The board's groups, then each group's rows, rise one stagger apart (`keyboard.row.arrive`). */
const STEP = staggerDelay('keyboard.row.arrive', 1);
export const BOARD_IN: Variants = { hidden: {}, show: { transition: { delayChildren: STEP, staggerChildren: STEP } } };
export const CLUSTER_IN: Variants = { hidden: {}, show: { transition: { staggerChildren: STEP } } };
export const ROW_IN: Variants = {
  hidden: { opacity: 0, y: amplitude('keyboard.row.arrive') },
  show: { opacity: 1, y: 0, transition: framerMotion('keyboard.row.arrive') },
};
/** Reduced motion keeps the cascade's order but drops the travel, so nothing slides. */
export const ROW_IN_REDUCED: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: framerMotion('selection.fade') },
};
