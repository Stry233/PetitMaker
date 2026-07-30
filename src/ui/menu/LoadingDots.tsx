/** Loading indicator shown in the Generate button while a recipe builds: three bouncing dots in the
 *  panel's playful, springy style (staggered loop).
 *  Also used by the AgentSection's "thinking" indicator (tinted via `color`).
 *  Own module (not GeneratePanel) so the lazily-loaded AgentSection can import it
 *  without a GeneratePanel ⇄ AgentSection module cycle. */
import { motion } from 'framer-motion';
import { colors as C } from '../styles';
import { usePx } from './scale';

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
