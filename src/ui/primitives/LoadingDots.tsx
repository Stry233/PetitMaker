/** Three bouncing dots on a staggered loop: the app's loader for ROOMY places — a button's own
 *  label while it works, a card waiting for its picture, a lazy chunk's fallback. `Spinner` is the
 *  other one, for tight ones. `color` tints them for whatever surface they stand on, and `size` (one
 *  dot's diameter in design px) shrinks the cluster for a small one — a line of text waiting on its
 *  first word, say. The gap keeps its proportion to the dot, so the cluster reads the same at any
 *  size and there is still exactly one dots loader in the app. */
import { motion } from 'framer-motion';
import { colors as C } from '../design/styles';
import { usePx } from '../design/scale';

/** One dot's diameter, in design px, and the gap's share of it. */
const DOT = 15;
const GAP_SHARE = 11 / DOT;

export function LoadingDots({ color, size = DOT }: { color?: string; size?: number } = {}) {
  const { px } = usePx();
  return (
    <div style={{ display: 'flex', gap: px(size * GAP_SHARE), alignItems: 'center', justifyContent: 'center' }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i}
          style={{ display: 'block', width: px(size), height: px(size), borderRadius: '50%', background: color ?? C.white }}
          animate={{ scale: [0.5, 1.15, 0.5], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.72, repeat: Infinity, delay: i * 0.14, ease: [0.45, 0, 0.55, 1] }} />
      ))}
    </div>
  );
}
