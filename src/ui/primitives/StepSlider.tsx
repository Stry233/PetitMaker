/**
 * The windows' stepped slider: a groove filled to the knob, a tick per stop with the default's tick
 * long, and the reading in a bubble over the knob while it is hovered or dragged. The owner holds the
 * value; a press or drag reports each stop it reaches once, and the knob glides to the value shown.
 * Arrow keys step, Home and End go to the ends, unless the owner answers keys itself.
 */
import type { KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { framerMotion } from '../design/motion';
import { cursors, font, radii, shadows } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { skin } from '../design/window-skin';
import { TouchReach } from './TouchReach';
import { useSliderInput } from './use-slider-input';

/** The track's height, in the window's px. */
const STEP_SLIDER_HEIGHT = 34;

export function StepSlider({ label, stops, value, valueText, onPick, onRelease, onKeyDown, onDoubleClick, mark, aria }: {
  label: string;
  /** How many stops the track has, two or more. */
  stops: number;
  /** The stop the knob shows. */
  value: number;
  /** What the shown stop reads as: the bubble's words and the announced value. */
  valueText: string;
  /** A press or drag reaching a stop, or a key stepping to one. */
  onPick: (stop: number) => void;
  /** The press or drag ending. */
  onRelease?: () => void;
  /** Answers keys in place of the slider's own stepping. */
  onKeyDown?: (e: KeyboardEvent) => void;
  onDoubleClick?: () => void;
  /** The stop drawn with the long tick: the default. */
  mark?: number;
  /** The numbers announced where the stop's index is not what the reading counts (a percentage). */
  aria?: { min: number; max: number; now: number };
}) {
  const last = Math.max(1, stops - 1);
  const { props, glide, reading } = useSliderInput<HTMLDivElement>({
    min: 0, max: last, value, onChange: onPick, label, valueText,
    ...(onRelease ? { onRelease } : {}), ...(onKeyDown ? { onKeyDown } : {}), ...(aria ? { aria } : {}),
  });

  return (
    <div
      {...props}
      onDoubleClick={onDoubleClick}
      style={{ position: 'relative', flex: 1, minWidth: 0, height: STEP_SLIDER_HEIGHT, cursor: cursors.clickable, touchAction: 'none', outline: 'none' }}
    >
      <TouchReach h={STEP_SLIDER_HEIGHT} sides={{ left: false, right: false }} />
      <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 10, background: skin.track, borderRadius: radii.pill }} />
      <motion.div style={{ position: 'absolute', top: 8, left: 0, width: glide.percent, height: 10, background: skin.active, borderRadius: radii.pill }} />
      {Array.from({ length: last + 1 }, (_, i) => {
        const long = i === mark;
        return (
          <span
            key={i}
            style={{
              position: 'absolute', top: 22, left: `${(i / last) * 100}%`, width: 1.5, height: long ? 8 : 5,
              background: long ? skin.muted : skin.track, opacity: long ? 0.55 : 1, transform: 'translateX(-50%)',
            }}
          />
        );
      })}
      <motion.div style={{ position: 'absolute', top: 13, left: glide.percent, width: 20, height: 20, x: '-50%', y: '-50%', borderRadius: '50%', background: skin.active, boxShadow: shadows.knob }} />
      {/* Framer centres the bubble with x: '-50%'; a CSS transform would fight the one Framer owns. */}
      <AnimatePresence>
        {reading && (
          <motion.div key="bubble"
            initial={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
            transition={framerMotion('surface.arrive')}
            style={{ position: 'absolute', left: glide.percent, bottom: '100%', marginBottom: 8, transformOrigin: 'bottom center', background: skin.ink, color: skin.onDark, fontFamily: font.family, ...roleFont('menu'), lineHeight: 1, padding: '4px 10px', borderRadius: radii.md, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: shadows.float }}>
            {valueText}
            <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${skin.ink}` }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
