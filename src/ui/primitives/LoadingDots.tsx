/** Three bouncing dots on a staggered loop: the app's loader for ROOMY places — a button's own
 *  label while it works, a card waiting for its picture, a lazy chunk's fallback. `Spinner` is the
 *  other one, for tight ones. `color` tints them for whatever surface they stand on. */
import { motion } from 'framer-motion';
import { colors as C } from '../design/styles';
import { usePx } from '../design/scale';

export function LoadingDots({ color }: { color?: string } = {}) {
  const { px } = usePx();
  return (
    <div style={{ display: 'flex', gap: px(11), alignItems: 'center', justifyContent: 'center' }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i}
          style={{ display: 'block', width: px(15), height: px(15), borderRadius: '50%', background: color ?? C.white }}
          animate={{ scale: [0.5, 1.15, 0.5], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.72, repeat: Infinity, delay: i * 0.14, ease: [0.45, 0, 0.55, 1] }} />
      ))}
    </div>
  );
}
