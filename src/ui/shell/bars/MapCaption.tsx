/** The name a frame control writes on the map under itself, centred and kept inside the window's left margin. */
import type { CSSProperties, ReactNode } from 'react';
import { motion, type MotionProps } from 'framer-motion';
import { captionShift } from '../units';

export function MapCaption({ top, centre, motionProps, style, children, ...attrs }: {
  /** Distance from the control's top edge, in its own px or as a CSS length. */
  top: number | string;
  /** The control's centre from the window's left edge, which clamps the caption; absent, it centres plainly. */
  centre?: number;
  /** How the caption comes and goes, for one shown under `AnimatePresence`. */
  motionProps?: MotionProps;
  style?: CSSProperties;
  children: ReactNode;
} & Record<`data-${string}`, string | boolean>) {
  return (
    <motion.span
      {...attrs}
      {...motionProps}
      style={{
        position: 'absolute', top, left: '50%',
        transform: centre === undefined ? 'translateX(-50%)' : captionShift(centre),
        whiteSpace: 'nowrap', pointerEvents: 'none', ...style,
      }}
    >
      {children}
    </motion.span>
  );
}
