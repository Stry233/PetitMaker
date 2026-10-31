import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LoadingDots } from './LoadingDots';
import { motion, type HTMLMotionProps, type TargetAndTransition, type Transition } from 'framer-motion';
import { cursors, UNAVAILABLE, type InteractionProfile } from '../design/styles';
import { useHover, useInteractionProfiles, useTouchMode } from '../design/input-mode';
import { TouchReach } from './TouchReach';
import { useInWindow } from './Window';
import { windowFooterGhost, windowFooterPrimary, windowFooterTertiary, windowPrimary } from '../design/window-skin';
import { hoverFillMotion, reportStyleFill } from './hover-fill';

const appearances = { plain: {}, primary: windowFooterPrimary, secondary: windowFooterGhost, tertiary: windowFooterTertiary, centered: windowPrimary };

export interface ActionButtonProps extends Omit<HTMLMotionProps<'button'>, 'whileHover' | 'whileTap'> {
  appearance?: keyof typeof appearances;
  interaction?: InteractionProfile;
  /** A run in flight: the label gives way to the loading dots in the same box, the button keeps its
   *  colour and focus, wears the busy cursor and refuses presses until the run ends. */
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
  hoverFill, fill, fillTransition, style, onClick, children, ...props
}, ref) {
  const refused = !busy && (disabled || !!refusing);
  const unavailable = busy || refused;
  const profile = useInteractionProfiles()[interaction];
  // Once a hover has tinted the fill, Framer owns it for the button's life, so the latch never lets go.
  const [tinted, setTinted] = useState(hoverFill !== undefined);
  if (hoverFill !== undefined && !tinted) setTinted(true);
  const own = style as CSSProperties | undefined;
  if (hoverFill !== undefined && fill === undefined) reportStyleFill(own, String((props as Record<string, unknown>)['data-testid'] ?? props['aria-label'] ?? 'ActionButton'));
  // A window's controls answer a fingertip in touch mode however small the window draws them (UI-34).
  const inWindow = useInWindow();
  const reach = useTouchMode() && inWindow;
  const state: CSSProperties = busy ? { position: 'relative', cursor: cursors.busy }
    : refused ? { ...(dim === 'self' ? { opacity: UNAVAILABLE } : {}), cursor: cursors.blocked } : {};
  const drawn: CSSProperties = { ...appearances[appearance], ...(reach ? { position: 'relative' } : null), ...state, ...own };
  const owned = fill !== undefined || tinted;
  const { background, backgroundColor, ...undrawn } = drawn;
  const resting = fill ?? (typeof (backgroundColor ?? background) === 'string' ? String(backgroundColor ?? background) : undefined);
  const filled = owned ? hoverFillMotion({ fill: resting, hoverFill, transition: fillTransition }) : null;
  // A finger never hovers, so touch mode drops the hover fill with the profile's hover growth.
  const hover: TargetAndTransition | undefined = useHover({ ...profile.whileHover, ...filled?.whileHover });
  return <motion.button {...profile} {...props} {...(filled ? { initial: filled.initial, animate: filled.animate } : {})} ref={ref} type={props.type ?? 'button'}
    disabled={!busy && disabled} aria-busy={busy || props['aria-busy']}
    aria-disabled={busy || (refusing ?? props['aria-disabled'])}
    whileHover={unavailable ? undefined : hover}
    whileTap={unavailable || !('whileTap' in profile) ? undefined : profile.whileTap}
    onClick={unavailable ? undefined : onClick}
    style={owned ? undrawn : drawn}>
    {busy ? (
      <>
        {/* The hidden label keeps the button's size, so nothing around it moves while it waits. */}
        <span style={{ display: 'contents', visibility: 'hidden' }}>{children as ReactNode}</span>
        <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingDots color="currentColor" />
        </span>
      </>
    ) : children as ReactNode}
    {reach && <TouchReach />}
  </motion.button>;
});
