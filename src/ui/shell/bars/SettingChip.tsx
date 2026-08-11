/*
 * SettingChip.tsx — the chip a tool cell carries inside its own pill, and the one shell every such
 * chip is built from.
 *
 * A chip here is a SETTING, not a tool: it never becomes a cell of the row, it stands inside the
 * active cell's plate (which is why the plate grows to hold it), and it says what the armed tool
 * will DO rather than arming anything itself. Auto trim is one; the eraser's shape is another.
 *
 * ONE BUTTON THAT CYCLES, not three that choose. Each of these settings has three states and no
 * midpoint between them, so a segmented control would spend three slots of a bar with no room for
 * them. The drawing carries the state, the plate carries whether it is doing anything, and the
 * accessible name says both in words.
 *
 * WHAT IT WEARS SAYS WHETHER IT IS ON. The pill under it is already the row's active yellow, so
 * yellow cannot mean "engaged" a second time inside it: working, the chip takes the frame's cream
 * plate, and at rest it stands bare on the yellow with its glyph hollow. Two fills rather than two
 * opacities, so the resting state is a shape the eye reads and not a dimmed version of the other.
 *
 * EVERY STATE NAMES THE SETTING, so the chip never has to. A state word has to stand on its own
 * here, since the chip shows one word and nothing around it says what the word is about.
 *
 * THE WORD LEAVES. A press says where the cycle landed, holds long enough to read and folds away
 * again — the chip is then a circle carrying the drawing, which is what the row is short of room
 * for. A hover brings the word back for as long as the pointer is there. It never appears on MOUNT:
 * arriving is not a change, and the control moves from cell to cell as the tool changes, so a
 * mount-time announcement would flash the word at every tool switch.
 *
 * A HOVER IS A POINTER ARRIVING, NOT A CONTROL ARRIVING UNDER A POINTER, and that distinction is
 * load-bearing rather than pedantic. This chip is revealed by the cell beside it opening into a
 * pill, and the reveal sweeps the chip sideways across whatever the pointer is resting on; pressing
 * the cell at its right edge lands the pointer on the chip without the pointer having moved at all.
 * Read as a hover, that opens the word, which widens the chip, which moves the edge the pointer is
 * being judged against, which answers with the opposite event: the fold pumps in and out for as
 * long as the pointer stands still, and the press that started it was a press at the edge. So the
 * chip listens for `pointermove` — a real change of coordinates over it — rather than for the
 * boundary crossing, which fires either way. Leaving is still the plain leave: a pointer that has
 * gone has gone, however the boundary got between them.
 *
 * WHAT THAT LEAVES IS A BOX THAT DOES NOT MOVE WHEN THE WORD OPENS, which is the only stable thing
 * to judge a pointer against. `ToolCell` sizes its clip to this chip's own measured width and
 * follows it with no transition once the pill has finished opening, so the chip is held at the
 * clip's closing edge with its LEFT edge standing still and the word grows rightward out of it: a
 * pointer inside stays inside. The one moment that edge does travel is the pill's reveal, when the
 * clip's spring is deliberately lagging the chip — and that is exactly the moment this gate refuses
 * to read a crossing as a hover, so the two halves are one answer rather than two.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { btnReset, buttonMotion, cursors, springs } from '../../design/styles';
import { INK, PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { BarText } from './bar-atoms';
import { PILL_H } from './terrain-cells';
import { useMotion } from '../motion/use-motion';

/**
 * The yellow that shows around the chip, in css px, and it is ONE number for all four sides.
 *
 * Judged against the 49 px pill: enough that the chip reads as something standing ON the pill rather
 * than as the pill's own end cap. One number keeps the chip centred in the shape holding it; sides
 * that differ set it off-centre. `ToolCell` takes this as the padding on BOTH sides of the box the
 * chip is revealed inside, and the chip's height comes out of it, which is what keeps the inset even
 * at both of the chip's widths: folded, the chip is a circle of that same height.
 */
export const CHIP_INSET = 7.5;

/**
 * The chip, in css px.
 *
 * `padX` is set so the GLYPH does not move as the word unfolds: at half the difference between the
 * chip's height and its drawing, the folded chip is a circle with the glyph on its centre, and the
 * word simply opens to the right of it. The glyph is drawn a shade bigger than the word beside it
 * because it is a solid shape against letterforms: matched to the type size it reads smaller.
 */
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

/** How long the state's name stands after a press, in ms. Long enough to read a word in any of the
 *  seven languages, short enough that the row is back to its resting width before the next stroke. */
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
