/*
 * Slider.tsx — a reusable track + knob slider with a value bubble that pops over
 * the knob on hover/drag. Extracted verbatim from GeneratePanel so it can be
 * reused; behaviour, props, and styles are unchanged. Top-level (not nested in a
 * parent component) so its hover/drag state survives the parent's re-renders.
 * Centering uses Framer Motion's x (not a CSS transform) so it doesn't fight the
 * scale/y animation.
 */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, inkTint, font, springs, cursors } from '../styles';
import { usePx } from './scale';
import { squircleClip } from './squircle';

/** Track + knob slider with a value bubble that pops over the knob on
 * hover/drag. Top-level (not nested in GeneratePanel) so its hover/drag state
 * survives the parent's re-renders. Centering uses Framer Motion's x (not a
 * CSS transform) so it doesn't fight the scale/y animation. */
export function Slider({ y, value, min, max, onChange, disabled = false }: { y: number; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  const { px, pxf, fw } = usePx();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const trackW = 628, trackH = 34, knob = 55;
  const ratio = (value - min) / (max - min || 1);
  // Fill ends at the thumb centre but never past the thumb's right edge, so at value 0 the rounded fill
  // cap stays tucked under the thumb instead of poking out beyond it.
  const fillPx = Math.min(Math.max(trackW * ratio, trackH), trackW * ratio + knob / 2);
  const drag = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(Math.round(min + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (max - min)));
  };
  return (
    <div ref={ref}
      style={{ position: 'absolute', left: px(172), top: px(y), width: px(trackW), height: px(trackH), cursor: disabled ? cursors.blocked : cursors.clickable, touchAction: 'none', opacity: disabled ? 0.4 : 1, filter: disabled ? 'saturate(0.4)' : 'none' }}
      onPointerEnter={() => !disabled && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => { if (disabled) return; setDragging(true); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag(e.clientX); }}
      onPointerMove={(e) => { if (!disabled && e.buttons) drag(e.clientX); }}
      onPointerUp={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}>
      <div style={{ position: 'absolute', inset: 0, clipPath: squircleClip(px(trackW), px(trackH), px(15)), background: colors.loadDark }} />
      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: px(fillPx), clipPath: squircleClip(px(fillPx), px(trackH), px(15)), background: colors.sliderYellow }} />
      <motion.div style={{ position: 'absolute', top: '50%', left: `${ratio * 100}%`, width: px(knob), height: px(knob), borderRadius: '50%', background: colors.sliderYellow, boxShadow: `0 2px 6px ${inkTint(0.3)}`, x: '-50%', y: '-50%' }} whileTap={disabled ? undefined : { scale: 1.15 }} />
      <AnimatePresence>
        {(hover || dragging) && (
          <motion.div key="bubble"
            initial={{ opacity: 0, scale: 0.6, x: '-50%', y: px(6) }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, scale: 0.6, x: '-50%', y: px(6) }}
            transition={springs.stiff}
            style={{ position: 'absolute', left: `${ratio * 100}%`, bottom: '100%', marginBottom: px(22), transformOrigin: 'bottom center', background: colors.frameDark, color: colors.white, fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(36), lineHeight: 1, padding: `${px(9)}px ${px(22)}px`, borderRadius: px(20), whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: `0 4px 12px ${inkTint(0.32)}` }}>
            {value}
            <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: `${px(10)}px solid transparent`, borderRight: `${px(10)}px solid transparent`, borderTop: `${px(10)}px solid ${colors.frameDark}` }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
