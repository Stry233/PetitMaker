/**
 * Compact cycling setting embedded in an active tool pill. A state change temporarily reveals its
 * localized name; pointer movement reveals it again. Boundary-entry events are ignored because the
 * parent pill can animate the chip under a stationary pointer and otherwise create a hover loop.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { btnReset, buttonMotion, cursors, springs } from '../../design/styles';
import { INK, PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { BarText } from './bar-atoms';
import { PILL_H } from './terrain-cells';
import { useMotion } from '../motion/use-motion';

/** Uniform inset used by both this chip and `ToolCell`'s reveal box. */
export const CHIP_INSET = 7.5;

/** Chip dimensions; horizontal padding keeps the glyph centered in the folded circle. */
const CHIP = {
  h: PILL_H - 2 * CHIP_INSET,
  glyph: 16,
  /** Between the glyph and the word, and it folds away with the word. */
  gap: 7,
} as const;
const CHIP_PAD_X = (CHIP.h - CHIP.glyph) / 2;

/** What the chip measures folded: a circle. The bar needs it to know where the narrowest pill puts
 *  its own centre, which is what the name under it is kept on screen by. */
export const CHIP_FOLDED_W = CHIP.h;

/** Time a changed state name remains expanded. */
const HOLD_MS = 2500;

export function SettingChip({ state, name, label, on, glyph, onCycle }: {
  /** The current state, as an opaque key: the chip re-mounts its drawing when this changes. */
  state: string;
  /** The state's own name, translated — the word that folds out. */
  name: string;
  /** The SETTING's name, translated, for the accessible name only. */
  label: string;
  /** Whether the setting is doing anything, which is what the chip's fill says. */
  on: boolean;
  /** The state's drawing, at the size and ink the chip decides. */
  glyph: (size: number, color: string) => ReactNode;
  onCycle: () => void;
}) {
  const reduceMotion = useReducedMotionConfig();
  const foldMotion = useMotion('chip.fold');
  const ink = on ? PLATE_INK : INK;

  const [held, setHeld] = useState(false);
  const [hovered, setHovered] = useState(false);
  const shown = useRef(state);
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    setHeld(true);
    const done = window.setTimeout(() => setHeld(false), HOLD_MS);
    return () => { window.clearTimeout(done); };
  }, [state]);

  /*
   * The word's width, measured rather than assumed: it is seven languages of a state name in a font
   * the page loads asynchronously, so there is no number to write down here. The span keeps its
   * natural width whatever the box around it is doing, so one observer reports both a locale change
   * and the font arriving.
   *
   * `offsetWidth`, not the client rect: the frame is drawn under a page `zoom`, and a rect comes
   * back in screen px while the width being animated is a css one.
   */
  const word = useRef<HTMLSpanElement>(null);
  const [wordW, setWordW] = useState(0);
  useLayoutEffect(() => {
    const el = word.current;
    if (!el) return;
    const measure = () => setWordW(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name]);

  const open = held || hovered;

  return (
    <motion.button
      type="button"
      {...buttonMotion}
      aria-label={`${label}: ${name}`}
      onClick={onCycle}
      onPointerMove={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerCancel={() => setHovered(false)}
      style={{
        ...btnReset, flex: 'none', pointerEvents: 'auto', cursor: cursors.clickable,
        height: CHIP.h, borderRadius: 999, padding: `0 ${CHIP_PAD_X}px`,
        // At rest it wears the translucent capsule the smart pill's unarmed segments wear: still
        // plainly a pill to press, just not the one that is on. Transparent read as a bare word.
        background: on ? PLATE : `${PLATE}80`,
        display: 'flex', alignItems: 'center',
      }}
    >
      {/* Keyed by the state, so the glyph REMOUNTS on each press and the shape swap reads as a small
          morph rather than as one drawing silently becoming another. Under reduced motion it simply
          arrives, which is the same end state. */}
      <motion.span
        key={state}
        aria-hidden
        initial={reduceMotion ? false : { scale: 0.4, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={springs.bouncy}
        style={{ display: 'flex', lineHeight: 0, flex: 'none' }}
      >
        {glyph(CHIP.glyph, ink)}
      </motion.span>
      {/* The FOLD. Width is not a transform, so Framer's own reduced-motion gate does not reach it
          and the transition comes from the registry, which returns no travel there. The gap folds
          away with the word, or a folded chip would carry 7 px of nothing. The three state words
          differ in length, so the open box differs with them: that is the word's own measurement
          arriving, not a second thing being animated. */}
      <motion.span
        aria-hidden
        animate={{ width: open ? CHIP.gap + wordW : 0, opacity: open ? 1 : 0 }}
        initial={false}
        transition={foldMotion}
        style={{ display: 'flex', overflow: 'hidden', flex: 'none' }}
      >
        <BarText
          size={TEXT.label}
          color={ink}
          style={{ flex: 'none', marginLeft: CHIP.gap }}
        >
          <span ref={word} style={{ display: 'block', whiteSpace: 'nowrap' }}>{name}</span>
        </BarText>
      </motion.span>
    </motion.button>
  );
}
