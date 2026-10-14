import { forwardRef } from 'react';
import { motion, type HTMLMotionProps, type TargetAndTransition } from 'framer-motion';
import { cursors, interactionProfiles, UNAVAILABLE, type InteractionProfile } from '../design/styles';
import { windowFooterGhost, windowFooterPrimary, windowFooterTertiary, windowPrimary } from '../design/window-skin';

const appearances = { plain: {}, primary: windowFooterPrimary, secondary: windowFooterGhost, tertiary: windowFooterTertiary, centered: windowPrimary };

export interface ActionButtonProps extends Omit<HTMLMotionProps<'button'>, 'whileHover' | 'whileTap'> {
  appearance?: keyof typeof appearances;
  interaction?: InteractionProfile;
  busy?: boolean;
  /** Refuses its action but stays focusable and named (`aria-disabled`), for a control whose press would only say why. */
  unavailable?: boolean;
  /** Where the dimming is drawn: on the button, or by the caller on a part of its drawing. */
  dim?: 'self' | 'caller';
  hoverFill?: string;
}

/** Layout and action order belong to the surface; input feedback and unavailable states belong here. */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton({
  appearance = 'plain', interaction = 'action', busy = false, disabled = false, unavailable: refusing, dim = 'self',
  hoverFill, style, onClick, ...props
}, ref) {
  const unavailable = busy || disabled || !!refusing;
  const profile = interactionProfiles[interaction];
  const hover: TargetAndTransition = { ...('whileHover' in profile ? profile.whileHover : {}), ...(hoverFill ? { backgroundColor: hoverFill } : {}) };
  return <motion.button {...profile} {...props} ref={ref} type={props.type ?? 'button'}
    disabled={busy || disabled} aria-busy={busy || props['aria-busy']}
    aria-disabled={refusing ?? props['aria-disabled']}
    whileHover={unavailable ? undefined : hover}
    whileTap={unavailable ? undefined : 'whileTap' in profile ? profile.whileTap : undefined}
    onClick={unavailable ? undefined : onClick}
    style={{ ...appearances[appearance], ...(unavailable ? { ...(dim === 'self' ? { opacity: UNAVAILABLE } : {}), cursor: cursors.blocked } : {}), ...style }} />;
});
