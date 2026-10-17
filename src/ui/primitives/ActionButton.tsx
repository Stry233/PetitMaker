import { forwardRef, useState, type CSSProperties } from 'react';
import { motion, type HTMLMotionProps, type TargetAndTransition, type Transition } from 'framer-motion';
import { cursors, interactionProfiles, UNAVAILABLE, type InteractionProfile } from '../design/styles';
import { windowFooterGhost, windowFooterPrimary, windowFooterTertiary, windowPrimary } from '../design/window-skin';
import { hoverFillMotion, reportStyleFill } from './hover-fill';

const appearances = { plain: {}, primary: windowFooterPrimary, secondary: windowFooterGhost, tertiary: windowFooterTertiary, centered: windowPrimary };

export interface ActionButtonProps extends Omit<HTMLMotionProps<'button'>, 'whileHover' | 'whileTap'> {
  appearance?: keyof typeof appearances;
  interaction?: InteractionProfile;
  busy?: boolean;
  /** Refuses its action but stays focusable and named (`aria-disabled`), for a control whose press would only say why. */
  unavailable?: boolean;
  /** Where the dimming is drawn: on the button, or by the caller on a part of its drawing. */
  dim?: 'self' | 'caller';
  /** What a hover tints the fill to. The resting fill then comes from `fill` or the appearance (`hover-fill.ts`);
   *  one in `style` is still drawn, and development builds report it. */
  hoverFill?: string;
  /** The resting fill a hover returns to, written as Framer's `animate` (replacing any passed). */
  fill?: string;
  /** How `fill` changes: a registry motion through `useTransition`. */
  fillTransition?: Transition;
}

/** Layout and action order belong to the surface; input feedback and unavailable states belong here. */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton({
  appearance = 'plain', interaction = 'action', busy = false, disabled = false, unavailable: refusing, dim = 'self',
  hoverFill, fill, fillTransition, style, onClick, ...props
}, ref) {
  const unavailable = busy || disabled || !!refusing;
  const profile = interactionProfiles[interaction];
  // Once a hover has tinted the fill, Framer owns it for the button's life, so the latch never lets go.
  const [tinted, setTinted] = useState(hoverFill !== undefined);
  if (hoverFill !== undefined && !tinted) setTinted(true);
  const own = style as CSSProperties | undefined;
  if (hoverFill !== undefined && fill === undefined) reportStyleFill(own, String((props as Record<string, unknown>)['data-testid'] ?? props['aria-label'] ?? 'ActionButton'));
  const drawn: CSSProperties = { ...appearances[appearance], ...(unavailable ? { ...(dim === 'self' ? { opacity: UNAVAILABLE } : {}), cursor: cursors.blocked } : {}), ...own };
  const owned = fill !== undefined || tinted;
  const { background, backgroundColor, ...undrawn } = drawn;
  const resting = fill ?? (typeof (backgroundColor ?? background) === 'string' ? String(backgroundColor ?? background) : undefined);
  const filled = owned ? hoverFillMotion({ fill: resting, hoverFill, transition: fillTransition }) : null;
  const hover: TargetAndTransition = { ...('whileHover' in profile ? profile.whileHover : {}), ...filled?.whileHover };
  return <motion.button {...profile} {...props} {...(filled ? { initial: filled.initial, animate: filled.animate } : {})} ref={ref} type={props.type ?? 'button'}
    disabled={busy || disabled} aria-busy={busy || props['aria-busy']}
    aria-disabled={refusing ?? props['aria-disabled']}
    whileHover={unavailable ? undefined : hover}
    whileTap={unavailable ? undefined : 'whileTap' in profile ? profile.whileTap : undefined}
    onClick={unavailable ? undefined : onClick}
    style={owned ? undrawn : drawn} />;
});
