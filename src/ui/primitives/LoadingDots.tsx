import { framerMotion, staggerDelay } from '../design/motion';
/** Roomy progress indicator; reduced motion keeps all three dots visible and still. */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { ON_DARK } from '../design/tokens';
import { useDevicePixelRatio } from '../design/scale';

/** One dot's diameter in css px at the chrome's reading size, and the gap's share of it. */
export const LOADING_DOT_PX = 8.4;
const GAP_SHARE = 11 / 15;

export function LoadingDots({ color, size = LOADING_DOT_PX }: { color?: string; size?: number } = {}) {
  const dpr = useDevicePixelRatio();
  // Lengths land on whole device pixels so the dots stay round and crisp.
  const device = (n: number) => Math.round(n * dpr) / dpr;
  const reduced = useReducedMotionConfig();
  return (
    <div style={{ display: 'flex', gap: device(size * GAP_SHARE), alignItems: 'center', justifyContent: 'center' }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i}
          style={{ display: 'block', width: device(size), height: device(size), borderRadius: '50%', background: color ?? ON_DARK }}
          animate={reduced ? { scale: 1, opacity: 1 } : { scale: [0.5, 1.15, 0.5], opacity: [0.45, 1, 0.45] }}
          transition={reduced ? framerMotion('loading.dots', true) : { ...framerMotion('loading.dots'), repeat: Infinity, delay: staggerDelay('loading.dots', i) }} />
      ))}
    </div>
  );
}
