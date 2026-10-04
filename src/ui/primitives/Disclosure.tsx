import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { framerMotion } from '../design/motion';
import type { MotionId } from '../shell/motion/registry';

interface DisclosureProps {
  children: ReactNode;
  /** Omit inside AnimatePresence; pass a boolean to retain mounted form state. */
  open?: boolean;
  motionId?: MotionId;
  spaceBefore?: number;
  spaceAfter?: number;
  testId?: string;
  style?: CSSProperties;
  inline?: boolean;
}

const RowGap = createContext(0);

/** Each departing row owns its gap; the final trailing gap stays outside the stack's measured height. */
export function DisclosureStack({ gap, children }: { gap: number; children: ReactNode }) {
  return <RowGap.Provider value={gap}>
    <div style={{ display: 'flow-root', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: -gap }}>{children}</div>
    </div>
  </RowGap.Provider>;
}

/** Spacing is part of the moving content; only a fully open disclosure releases its clip. */
export function Disclosure({ children, open, motionId = 'panel.detail.unfold', spaceBefore = 0, spaceAfter, testId, style, inline = false }: DisclosureProps) {
  const gap = useContext(RowGap);
  const present = useIsPresent();
  const reduced = useReducedMotionConfig() === true;
  const shown = present && open !== false;
  const Frame = inline ? motion.span : motion.div;
  const Body = inline ? 'span' : 'div';
  return (
    <Frame
      {...(shown ? {} : { inert: '' })}
      data-testid={testId}
      aria-hidden={!shown || undefined}
      initial={reduced || open !== undefined ? false : { height: 0, opacity: 0 }}
      animate={shown
        ? { height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }
        : { height: 0, opacity: 0, overflow: 'hidden' }}
      exit={reduced ? undefined : { height: 0, opacity: 0, overflow: 'hidden' }}
      transition={framerMotion(motionId, reduced)}
      style={{ display: 'block', flex: '0 0 auto', overflow: 'hidden', ...style, pointerEvents: shown ? undefined : 'none' }}
    >
      <RowGap.Provider value={0}>
        <Body style={{ display: 'flow-root', paddingTop: spaceBefore, paddingBottom: spaceAfter ?? gap }}>{children}</Body>
      </RowGap.Provider>
    </Frame>
  );
}
