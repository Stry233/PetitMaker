import { framerMotion, staggerDelay } from '../design/motion';
/** Roomy progress indicator; reduced motion keeps all three dots visible and still. */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { colors as C } from '../design/styles';
import { usePx } from '../design/scale';

/** One dot's diameter, in design px, and the gap's share of it. */
const DOT = 15;
const GAP_SHARE = 11 / DOT;

export function LoadingDots({ color, size = DOT }: { color?: string; size?: number } = {}) {
  const { px } = usePx();
  const reduced = useReducedMotionConfig();
  return (
    <div style={{ display: 'flex', gap: px(size * GAP_SHARE), alignItems: 'center', justifyContent: 'center' }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i}
          style={{ display: 'block', width: px(size), height: px(size), borderRadius: '50%', background: color ?? C.white }}
          animate={reduced ? { scale: 1, opacity: 1 } : { scale: [0.5, 1.15, 0.5], opacity: [0.45, 1, 0.45] }}
          transition={reduced ? framerMotion('loading.dots', true) : { ...framerMotion('loading.dots'), repeat: Infinity, delay: staggerDelay('loading.dots', i) }} />
      ))}
    </div>
  );
}
