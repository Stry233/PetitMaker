import type { ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { INK } from '../../design/tokens';
import { useMotion } from '../motion/use-motion';
import { QUAD } from '../units';
import { CELL_BOX } from './ToolCell';

/** Replace whole setting groups after their exit so captions never overlap during a tool switch. */
export function ToolOptions({ mode, children }: { mode: string | null; children: ReactNode }) {
  const reduced = useReducedMotionConfig();
  const group = mode ? <OptionGroup key={mode}>{children}</OptionGroup> : null;
  return reduced ? group : <AnimatePresence initial={false} mode="wait">{group}</AnimatePresence>;
}

function OptionGroup({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const transition = useMotion('tool.options.visibility');
  return <motion.div data-tool-options aria-hidden={!present || undefined} {...(!present ? { inert: '' } : {})}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}
    style={{ display: 'flex', alignItems: 'flex-start', flex: 'none', gap: QUAD.gap }}>
    <span aria-hidden style={{ width: 1, height: 26, marginTop: (CELL_BOX.h - 26) / 2, background: INK, opacity: .25, flex: 'none' }}/>
    {children}
  </motion.div>;
}
