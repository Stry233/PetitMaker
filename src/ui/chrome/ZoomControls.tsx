import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useRef } from 'react';
import { getActiveView } from '../../canvas/active-view';
import { pressable, springs } from '../styles';
import { useT } from '../../i18n/context';
import { usePressRepeat } from '../usePressRepeat';
import { FloatingCluster, floatingBtn } from './FloatingCluster';
import { IconPlus, IconMinus, IconChevronUp, IconChevronDown, IconFit } from './glyph-icons';

export interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** 3D mode adds camera-tilt steppers: the only tilt affordance (one touch
   *  finger drives the tool, two drive pan/pinch/twist — no gesture is free). */
  tilt?: boolean;
}

export function ZoomControls({ onZoomIn, onZoomOut, onFit, tilt = false }: ZoomControlsProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  // Hold-to-repeat zoom. These buttons drive MAP viewport zoom via __petitZoomIn/Out,
  // each a 220ms camera tween; a 200ms repeat keeps held presses from stacking into
  // judder. Fit stays a plain single click (no repeat).
  const zoomInPress = usePressRepeat({ action: onZoomIn, intervalMs: 200 });
  const zoomOutPress = usePressRepeat({ action: onZoomOut, intervalMs: 200 });
  const tiltValue = useRef(0.55);
  const tiltStep = (d: number) => {
    tiltValue.current = Math.max(0, Math.min(1, tiltValue.current + d));
    getActiveView()?.camera.tilt?.(tiltValue.current);
  };
  const tiltUpPress = usePressRepeat({ action: () => tiltStep(0.06), intervalMs: 120 });
  const tiltDownPress = usePressRepeat({ action: () => tiltStep(-0.06), intervalMs: 120 });
  return (
    <FloatingCluster corner="bottom-right">
      <motion.button style={floatingBtn} {...pressable} {...zoomInPress} aria-label={t('a11y.zoom_in')} title={t('a11y.zoom_in')}><IconPlus /></motion.button>
      <motion.button style={floatingBtn} {...pressable} {...zoomOutPress} aria-label={t('a11y.zoom_out')} title={t('a11y.zoom_out')}><IconMinus /></motion.button>
      {/* The tilt steppers are 3D-only; switching 2D<->3D collapses/expands each
          one. Animating each BUTTON's own height + a -10 margin (which cancels the
          cluster's flex gap) grows the space smoothly with no jump, and a fixed px
          height (not 'auto') avoids the measure-flash. overflow:hidden clips the
          icon during the collapse but NOT the button's own drop shadow, so the
          shadow is never clipped. */}
      <AnimatePresence initial={false}>
        {tilt && [
          <motion.button
            key="tilt-up"
            style={{ ...floatingBtn, overflow: 'hidden' }}
            {...pressable}
            {...tiltUpPress}
            aria-label={t('a11y.tilt_up')}
            title={t('a11y.tilt_up')}
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: -10 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: 46, marginTop: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: -10 }}
            transition={reduced ? { duration: 0 } : springs.gentle}
          >
            <IconChevronUp />
          </motion.button>,
          <motion.button
            key="tilt-down"
            style={{ ...floatingBtn, overflow: 'hidden' }}
            {...pressable}
            {...tiltDownPress}
            aria-label={t('a11y.tilt_down')}
            title={t('a11y.tilt_down')}
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: -10 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: 46, marginTop: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: -10 }}
            transition={reduced ? { duration: 0 } : springs.gentle}
          >
            <IconChevronDown />
          </motion.button>,
        ]}
      </AnimatePresence>
      <motion.button style={floatingBtn} {...pressable} onClick={onFit} aria-label={t('a11y.fit_view')} title={t('a11y.fit_view')}><IconFit /></motion.button>
    </FloatingCluster>
  );
}
