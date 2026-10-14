import type { Variants } from 'framer-motion';
import { framerMotion } from '../../../design/motion';

export const BOARD_IN: Variants = { hidden: {}, show: { transition: { delayChildren: 0.05, staggerChildren: 0.045 } } };
export const CLUSTER_IN: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.028 } } };
export const ROW_IN: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 520, damping: 34, mass: 0.6 } },
};
/** Reduced motion keeps the cascade's order but drops the travel, so nothing slides. */
export const ROW_IN_REDUCED: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: framerMotion('selection.fade') },
};
