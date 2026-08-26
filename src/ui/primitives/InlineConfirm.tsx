/*
 * InlineConfirm.tsx — a destructive verb that BECOMES its own question.
 *
 * One press turns the button's words into the question's words and its fill danger; a second press on
 * that same button is the answer; a press anywhere else, or Escape, puts it back. There is no second
 * control, no strip under the row, and nothing added to the row's count — the only thing that changes
 * size is the one button, by the width of its own label.
 *
 * THAT IS THE WHOLE REASON IT IS THIS SHAPE. A confirmation that opens a yes/no PAIR asks the row for
 * width at the one moment the interface is asking for a deliberate answer, and every verb the hand is
 * already travelling toward moves for it. Here the target does not move at all: it is the control the
 * pointer is on, saying what pressing it again will do.
 *
 * THE COST GOES IN THE QUESTION. "Rewind 4 steps?" is the verb, the size and the question in the one
 * label, so a destructive press names what it takes without a second line to carry it.
 *
 * AND THE WORDS ARE AUTHORED, NOT ASSEMBLED. A question form is not the verb with a '?' glued on:
 * French puts a space before the mark, Japanese and Chinese have their own, and several languages
 * reorder the sentence. So the caller hands in the locale's own question string, exactly the way it
 * hands in the locale's own label — it is given `armed` and draws whichever of the two applies.
 *
 * WHAT THE HOST STILL OWNS IS THE DIMMING, because only the host knows which of its own verbs are
 * siblings of this one. It is told two ways, and they are the same fact: `data-confirm-armed` on the
 * seat, for a stylesheet, and `onOpenChange`, for a surface that paints its verbs from state (which
 * every surface here does). `HUSHED` is the treatment to apply — the one that keeps the rect.
 *
 * OPEN STATE IS THE HOST'S TO KEEP OR NOT. Uncontrolled is the short road for a lone confirm; passing
 * `open` makes the host the owner, which a row that dims its siblings already is. Holding the state in
 * both places is what makes a row disagree with itself.
 *
 * THE ARMING IS ONE CONTINUOUS MORPH OF ONE BOX, on a motion the surface hands in (`arm`): a part may
 * not read the interface's motion table, so the surface that has a declaration passes the
 * declaration. The seat's width TWEENS to whatever the question's words need and the fill crosses to
 * danger over the same beat, so what a viewer reads is this button growing into its question. Never a
 * pulse or a pop: a bounce reads as one control being replaced by another, which is the exact thing
 * an in-place confirm exists to avoid.
 *
 * THE WIDTH IS MEASURED, because `auto` is not a length anything can tween from. The seat is let go
 * for one synchronous measurement after each change of words and the reading is `offsetWidth`, NOT a
 * rect: these verbs stand inside the frame's css `zoom`, where a rect answers in visual px while an
 * inline `width` is written in the element's own.
 */
import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { motion } from 'framer-motion';
import type { Transition } from 'framer-motion';
import { cursors, UNAVAILABLE } from '../design/styles';

/**
 * What a verb wears while a sibling confirm stands: dimmed to the house unavailable level and deaf
 * to the pointer, at exactly the size and place it already had. Never `display: none` and never a
 * width change — either one reflows the row, which is the whole thing this component exists to
 * prevent.
 */
export const HUSHED: CSSProperties = {
  opacity: UNAVAILABLE,
  pointerEvents: 'none',
  cursor: cursors.blocked,
};

/** The beat a trigger grows into its question on, in the two shapes the morph needs. Handed in rather
 *  than named here, for the reason the file header gives (`ui/agent/motion.ts:CONFIRM_ARM`). */
export interface ConfirmArm {
  /** The seat's width tween. */
  transition: Transition;
  /** The same beat as a css `transition` value over the colours: the primitive owns WHEN the fill
   *  crosses, the caller owns which fill it crosses to. */
  paint: string;
}

export interface InlineConfirmProps {
  /** The question the armed button is asking, as its accessible name. The words the button DRAWS are
   *  the caller's; this is what a screen reader is told, since a button whose meaning has changed
   *  under the pointer must say so. */
  question: string;
  onConfirm: () => void;
  /** Told whenever the question goes away unanswered: an outside press, Escape, or a second host. */
  onCancel?: () => void;
  /** Present = the HOST owns the armed state. Absent = this component keeps it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  arm: ConfirmArm;
  /** The trigger, drawn in whichever state it stands in. Its own `onClick` still runs on the FIRST
   *  press; the second press is the answer and is this component's. */
  children: (armed: boolean) => ReactElement;
}

export function InlineConfirm({
  question, onConfirm, onCancel, open: controlled, onOpenChange, arm, children,
}: InlineConfirmProps) {
  const [ownArmed, setOwnArmed] = useState(false);
  const armed = controlled ?? ownArmed;

  const setArmed = useCallback((next: boolean) => {
    if (controlled === undefined) setOwnArmed(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);

  const seat = useRef<HTMLSpanElement>(null);
  const cancel = useCallback(() => { setArmed(false); onCancel?.(); }, [setArmed, onCancel]);

  /*
   * THE ARMED STATE IS DISMISSED BY ANYTHING THAT IS NOT THIS BUTTON.
   *
   * `pointerdown` at the document, in the CAPTURE phase, so a press meant for another control cancels
   * before that control acts on it. Escape does the same and STOPS THERE: an armed question is the
   * innermost thing on screen, and the surfaces that carry these verbs fold on Escape themselves, so
   * a key that travelled on would dismiss the question and take the whole card with it.
   */
  useEffect(() => {
    if (!armed) return undefined;
    const away = (e: Event): void => {
      if (seat.current?.contains(e.target as Node) === true) return;
      cancel();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cancel();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [armed, cancel]);

  /**
   * WHAT THE QUESTION'S WORDS NEED, in the seat's own px.
   *
   * Read after every change of state or of words, and read with the tween's own width taken OFF for
   * the length of one measurement: an animated box asked for its width answers with wherever the
   * tween has got to, which would make each arming start from the last one's finish line.
   */
  const [wide, setWide] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = seat.current;
    if (!el) return;
    const held = el.style.width;
    el.style.width = 'auto';
    const natural = el.offsetWidth;
    el.style.width = held;
    setWide(natural > 0 ? natural : null);
  }, [armed, question]);

  const drawn = children(armed);
  const trigger = cloneElement(drawn, {
    onClick: (e: MouseEvent<HTMLElement>) => {
      drawn.props.onClick?.(e);
      if (armed) { setArmed(false); onConfirm(); return; }
      setArmed(true);
    },
    // THE FILL CROSSES ON THE SAME BEAT THE BOX GROWS ON, which is what makes the two one move. The
    // caller draws whichever colours its own two states are; the length and curve of the crossing are
    // this component's, and `animations.css` collapses the declaration under reduced motion.
    //
    // AND THE TRIGGER CLIPS ITS OWN CONTENTS, which is what keeps the growth inside the shape the
    // caller drew: the words change in one frame while the box takes the declared beat to reach them,
    // and clipping on the trigger means the caller's own border-radius is the edge they are revealed
    // behind rather than a square cut by a wrapper that cannot know the radius.
    style: {
      ...(drawn.props.style as CSSProperties | undefined),
      overflow: 'hidden',
      transition: arm.paint,
    },
  } as Partial<typeof drawn.props>);

  return (
    <motion.span
      ref={seat}
      data-testid="inline-confirm-seat"
      data-confirm-armed={armed || undefined}
      aria-label={armed ? question : undefined}
      // ONE BOX, GROWING. `initial={false}` is what keeps the first paint at its own size rather than
      // tweening in from nothing, and a seat that has not been measured yet stands at `auto` so it is
      // never drawn at a width nobody chose.
      initial={false}
      animate={wide === null ? {} : { width: wide }}
      transition={arm.transition}
      style={SEAT}
    >
      {trigger}
    </motion.span>
  );
}

/**
 * The seat: an inline box holding the one button, so a row sees the same single child whichever of the
 * two states it is in.
 *
 * A GRID, so the growth belongs to the BUTTON rather than to the slot around it. A grid item's own
 * width stretches to its column, so the width tweened here IS the trigger's width and what a viewer
 * watches is that one button growing. In a flex seat the trigger would either be squeezed by the tween
 * or stand at its final size inside a slot that was still catching up, and both of those read as the
 * button being replaced rather than changing.
 */
const SEAT: CSSProperties = {
  display: 'inline-grid',
  alignItems: 'center',
  flex: '0 0 auto',
};
