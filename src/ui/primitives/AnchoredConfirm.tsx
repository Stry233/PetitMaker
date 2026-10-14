import type { RefObject } from 'react';
import { motion, useIsPresent, useReducedMotionConfig, type MotionProps, type MotionStyle } from 'framer-motion';
import { amplitude, framerMotion} from '../design/motion';
import { z } from '../design/styles';
import { cozyPanel } from '../design/window-skin';
import { ConfirmationContent, confirmationCardStyle, type ConfirmationContentProps } from './ConfirmationContent';
import { useFloatingPosition, type FloatingTarget } from './use-floating-position';
import { useSurfaceScope } from './surface-scope';
import { helpAttributes, type HelpTarget } from './help-target';

/** Space between the card and the control it grows from, in css px. */
const ANCHOR_GAP = 8;

/**
 * The arrival and departure every card anchored to a control shares: it grows from the control on
 * `anchored.card.arrive` and is put away on `surface.leave`. Pair it with `anchoredOrigin`.
 */
export function anchoredCardMotion(reduced: boolean): Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'> {
  const from = 1 - amplitude('anchored.card.arrive');
  return {
    initial: { scale: from, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    exit: { scale: from, opacity: 0, transition: framerMotion('surface.leave', reduced) },
    transition: framerMotion('anchored.card.arrive', reduced),
  };
}

/** The card's transform origin: the edge facing its control, at the side it is aligned to, or at
 *  `at` (the control's point along that edge in the card's px) once a placement knows it. */
export function anchoredOrigin(above: boolean, align: 'start' | 'center' | 'end', at?: number): string {
  const x = at === undefined ? (align === 'start' ? 'left' : align === 'end' ? 'right' : 'center') : `${at}px`;
  return `${x} ${above ? 'bottom' : 'top'}`;
}

interface AnchoredConfirmProps extends ConfirmationContentProps {
  /** Where the card grows from. Absent, the card stands wherever `style` puts it and owns no dismissal. */
  anchor?: FloatingTarget;
  /** The control that asked: pressing it again closes the card rather than counting as a press outside. */
  trigger?: RefObject<HTMLElement | null>;
  prefer?: 'above' | 'below';
  /** Keep the side the card opened on while its content grows (`useFloatingPosition`). */
  lockSide?: boolean;
  align?: 'start' | 'center' | 'end';
  /** The chrome zoom the card draws at. */
  zoom?: number;
  width?: number;
  helpTarget?: HelpTarget;
  style?: MotionStyle;
  testId?: string;
}

/**
 * A confirmation card that grows from a control or a point on screen. Mount it under
 * `AnimatePresence` so it plays its exit; Escape and a press outside answer Cancel.
 */
export function AnchoredConfirm({
  anchor, trigger, prefer, lockSide, align = 'center', zoom = 1, width = 320, helpTarget, style, testId, ...content
}: AnchoredConfirmProps) {
  const present = useIsPresent();
  const reduced = useReducedMotionConfig() === true;
  const floating = useFloatingPosition({ open: !!anchor && present, anchor: anchor ?? { x: 0, y: 0 }, zoom, align, gap: ANCHOR_GAP, prefer, lockSide });
  useSurfaceScope({ open: !!anchor && present && !!floating.placement, root: floating.ref, trigger, onClose: content.onCancel, focus: 'contain', outside: true });
  return (
    <motion.div ref={floating.ref} role="dialog" aria-label={content.title} data-testid={testId}
      {...helpAttributes(helpTarget)}
      {...anchoredCardMotion(reduced)}
      style={{
        ...cozyPanel, ...confirmationCardStyle, position: 'fixed', zIndex: z.contextMenu, width,
        transformOrigin: anchoredOrigin(!!floating.placement?.above, align),
        ...style, ...(anchor ? floating.style : {}),
      }}
    >
      <ConfirmationContent {...content} />
    </motion.div>
  );
}
