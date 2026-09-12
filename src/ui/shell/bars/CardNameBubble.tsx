/*
 * CardNameBubble.tsx — the hovered tile's name, floating above the row that clips it.
 *
 * A scroll container clips on both axes, so a label standing above a tile inside one would be cut
 * in half. This draws OUTSIDE the row, at a `centre` the caller has already corrected for its own
 * scroll offset, which is what lets the object shelf's card row and the road strip share one
 * component even though their coordinate spaces are scaled differently.
 *
 * THE BUBBLE HAS A WIDTH IT WILL NOT PASS. A catalog name is as long as its language makes it — the
 * Russian cobblestone path runs to forty characters — and a bubble that simply grew to fit reached
 * across half the row and named a tile nowhere near its middle. So the name is given a window of
 * `MAX_EM` and, where it does not fit, travels along inside it, softened at both ends by the same
 * shade a scroller wears (`primitives/scroll-fade.ts`) so the cut reads as more word rather than as
 * a drawing error. Under reduced motion the window is the same width and the name WRAPS down it
 * instead: the travel is decoration, the name is not.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import { fadeMask } from '../../primitives/scroll-fade';
import { MAP_LABEL } from '../../design/tokens';
import { TEXT } from '../units';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { MOTIONS } from '../motion/registry';
import { STILL, useMotion, useMotionAllowed } from '../motion/use-motion';

/**
 * How wide the bubble may grow, in ems of its own type.
 *
 * Written in em rather than px because what has to be judged is how much WORD stands over a tile,
 * and that is a measure of the type and not of the frame: at thirteen the longest names in the
 * catalog show most of themselves at once and the bubble stays about three swatches wide, which is
 * near enough to the tile it names for the two to read as one thing.
 */
const MAX_EM = 13;

/** How far the name is softened at each end of the window it runs through, in css px: about two
 *  thirds of an em, which is a glyph's worth of dissolve at this size. */
const FADE = Math.round(TEXT.label * 0.66);

/** The share of one round trip the name stands STILL at an end, either end. A name that turned the
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

/**
 * The name itself, inside the bubble's window.
 *
 * Its OWN component, so each keyed bubble carries its own refs and its own measurement: while one
 * name is leaving and the next arriving, `AnimatePresence` holds both on screen at once, and a
 * single pair of refs shared between them would be pointed at whichever mounted last and then
 * nulled by whichever unmounted first.
 */
function NameText({ name }: { name: string }) {
  const marquee = useMotion('item.name.marquee');
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
        transition={runs ? { ...marquee, times: [0, REST, 0.5, 0.5 + REST, 1] } : STILL}
        // Centred only where it WRAPS: a centred line wider than its box overhangs both ends of it,
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
  const nameMotion = useMotion('item.name.reach');
  const weightAt = useFrameReadableWeight();
  return (
    <AnimatePresence>
      {reached ? (
        <motion.span
          key={reached.name}
          data-testid="shell-card-name"
          initial={{ opacity: 0, x: '-50%', y: 4 }}
          animate={{ opacity: 1, x: '-50%', y: 0 }}
          exit={{ opacity: 0, x: '-50%' }}
          transition={nameMotion}
          style={{
            // Block, and the width is the name's own: an absolutely positioned box shrinks to fit
            // its content, so a short name keeps exactly the bubble it has today and only a long one
            // meets the cap. It is also what keeps a scaled label off the parent's unscaled strut.
            position: 'absolute', display: 'block',
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
