import { forwardRef } from 'react';
import { motion, type HTMLMotionProps, type TargetAndTransition } from 'framer-motion';
import { cursors, interactionProfiles, UNAVAILABLE, type InteractionProfile } from '../design/styles';
import { windowFooterGhost, windowFooterPrimary, windowFooterTertiary, windowPrimary } from '../design/window-skin';

const appearances = { plain: {}, primary: windowFooterPrimary, secondary: windowFooterGhost, tertiary: windowFooterTertiary, centered: windowPrimary };

export interface ActionButtonProps extends Omit<HTMLMotionProps<'button'>, 'whileHover' | 'whileTap'> {
  appearance?: keyof typeof appearances;
  interaction?: InteractionProfile;
  busy?: boolean;
  hoverFill?: string;
}

/** Layout and action order belong to the surface; input feedback and unavailable states belong here. */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton({
  appearance = 'plain', interaction = 'action', busy = false, disabled = false, hoverFill, style, onClick, ...props
}, ref) {
  const unavailable = busy || disabled;
  const profile = interactionProfiles[interaction];
  const hover: TargetAndTransition = { ...('whileHover' in profile ? profile.whileHover : {}), ...(hoverFill ? { backgroundColor: hoverFill } : {}) };
  return <motion.button {...profile} {...props} ref={ref} type={props.type ?? 'button'}
    disabled={unavailable} aria-busy={busy || props['aria-busy']}
    whileHover={unavailable ? undefined : hover}
    whileTap={unavailable ? undefined : 'whileTap' in profile ? profile.whileTap : undefined}
    onClick={unavailable ? undefined : onClick} style={{ ...appearances[appearance], ...(unavailable ? { opacity: UNAVAILABLE, cursor: cursors.blocked } : {}), ...style }} />;
});
