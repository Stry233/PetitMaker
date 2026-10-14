/*
 * The hovered tile's name, drawn outside the clipping row at a scroll-corrected `centre` (the object
 * shelf and the road strip share it). The bubble stops at `MAX_EM`: a longer name travels inside it,
 * faded at both ends, or wraps under reduced motion.
 */
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import { fadeMask } from '../../primitives/scroll-fade';
import { MAP_LABEL } from '../../design/tokens';
import { TEXT } from '../units';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { MOTIONS } from '../../design/motion/registry';
import { useTransition, useMotionAllowed } from '../../design/motion/use-motion';
import { NO_MOTION, presence } from '../../design/motion';

/** How wide the bubble may grow, in ems of its type, so it stays near the tile it names. */
const MAX_EM = 13;

/** How far the name is softened at each end of the window it runs through, in css px: about two
 *  thirds of an em, which is a glyph's worth of dissolve at this size. */
const FADE = Math.round(TEXT.label * 0.66);

/** The share of one round trip the name stands still at an end, either end. A name that turned the
 *  moment it arrived would never be readable at the end that matters most, which is the far one. */
const REST = 0.18;

/** Below this overrun the name is left clipped rather than scrolled: the registry's own floor for
 *  this motion, read rather than restated. */
const MIN_TRAVEL = MOTIONS['item.name.marquee'].amplitude;

export interface CardNameReach {
  name: string;
  /** The tile's middle, in the caller's own left-offset coordinate space (scroll already taken
   *  back out), which is what `left` is set to. */
  centre: number;
}

/** The name inside the bubble, its own component so leaving and arriving bubbles keep their own refs. */
function NameText({ name }: { name: string }) {
  const marquee = useTransition('item.name.marquee');
  const travels = useMotionAllowed('item.name.marquee');
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    // A wrapped name has no overrun by construction. Where there is no layout at all (jsdom) both
    // numbers are zero, which is the same answer as "it fits" and leaves the bubble as it was.
    if (!box || !text || !travels) { setOver(0); return; }
    setOver(Math.max(0, text.scrollWidth - box.clientWidth));
  }, [name, travels]);

  const runs = travels && over >= MIN_TRAVEL;
  const mask = travels && over > 0 ? fadeMask('x', { start: FADE, end: FADE }) : undefined;

  return (
    <span
      ref={boxRef}
      style={{
        display: 'block',
        ...(travels ? { overflow: 'hidden' } : {}),
        ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
      }}
    >
      <motion.span
        ref={textRef}
        // Out, hold, back, hold, on one clock: the pauses are keyframes of the same run rather than
        // a second timer, so the turn cannot drift out of phase with the travel.
        animate={runs ? { x: [0, 0, -over, -over, 0] } : { x: 0 }}
        transition={runs ? { ...marquee, times: [0, REST, 0.5, 0.5 + REST, 1] } : NO_MOTION}
        // Centred only where it wraps: a centred line wider than its box overhangs both ends of it,
        // which would start the travel with the name already half off its left edge.
        style={{
          display: 'block',
          ...(travels ? { whiteSpace: 'nowrap' } : { whiteSpace: 'normal', textAlign: 'center' }),
        }}
      >
        {name}
      </motion.span>
    </span>
  );
}

/** `lift` is the air the caller keeps between its own tiles and the name over them, in css px. Zero
 *  where the row already reserves that room above itself, as the object shelf's does. */
export function CardNameBubble({ reached, lift = 0 }: { reached: CardNameReach | null; lift?: number }) {
  const reduced = useReducedMotionConfig();
  const weightAt = useFrameReadableWeight();
  return (
    <AnimatePresence>
      {reached ? (
        <motion.span
          key={reached.name}
          data-testid="shell-card-name"
          {...presence('item.name.reach', { opacity: 0, y: 4 }, { exit: { opacity: 0 }, hold: { x: '-50%' }, reduced })}
          style={{
            // Size to the name even when its anchor is a single tile, then cap long labels.
            position: 'absolute', display: 'block', width: 'max-content',
            bottom: lift ? `calc(100% + ${lift}px)` : '100%', left: reached.centre,
            maxWidth: `${MAX_EM}em`,
            fontSize: TEXT.label, fontWeight: weightAt(800, TEXT.label), lineHeight: 1.15,
            pointerEvents: 'none', ...MAP_LABEL,
          }}
        >
          <NameText name={reached.name} />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
