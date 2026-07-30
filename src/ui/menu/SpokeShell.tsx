/*
 * SpokeShell.tsx — the pop-from-phone motion wrapper shared by the Build and
 * Placement spoke panels. Each spoke is a fixed-position speech bubble that pops
 * in FROM the phone (scale + fade, bouncy spring) originating at its tail tip
 * (transformOrigin), and settles out via the shared exitTransition inside
 * AnimatePresence.
 *
 * Takes design-px coords (x/y/width/height); it applies the current scale (px)
 * and the uiZoom centre offset itself so the callers don't repeat that plumbing.
 * (Generate is NOT converted: its wrapper is deliberately pointerEvents:'none'
 * with a different inner structure.)
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { springs, exitTransition } from '../styles';
import { usePx, useMenuCenterOffset } from './scale';

interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
  origin: string;
  children: ReactNode;
}

export function SpokeShell({ x, y, width, height, origin, children }: Props) {
  const { px } = usePx();
  const offsetY = useMenuCenterOffset();
  return (
    <motion.div
      style={{ position: 'fixed', left: px(x), top: px(y) + offsetY, width: px(width), height: px(height), zIndex: 110, transformOrigin: origin }}
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.4, opacity: 0, transition: exitTransition }}
      transition={springs.bouncy}
    >
      {children}
    </motion.div>
  );
}
