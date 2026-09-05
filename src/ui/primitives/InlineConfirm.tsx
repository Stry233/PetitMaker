/**
 * Two-step destructive action that turns its existing button into a localized confirmation prompt.
 * Escape or an outside press cancels it. The host may control the armed state and dim siblings with
 * `HUSHED`. Width is measured with `offsetWidth` so the morph uses local CSS pixels under page zoom.
 */
import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { motion } from 'framer-motion';
import type { Transition } from 'framer-motion';
import { cursors, UNAVAILABLE } from '../design/styles';

/** Non-interactive sibling style that preserves row layout while confirmation is armed. */
export const HUSHED: CSSProperties = {
  opacity: UNAVAILABLE,
  pointerEvents: 'none',
  cursor: cursors.blocked,
};

/** Caller-supplied width and color timing for the confirmation morph. */
export interface ConfirmArm {
  /** The seat's width tween. */
  transition: Transition;
  /** CSS transition for caller-owned colors. */
  paint: string;
}

export interface InlineConfirmProps {
  /** Accessible name while armed; the caller supplies the visible wording. */
  question: string;
  onConfirm: () => void;
  /** Called when the prompt closes without confirmation. */
  onCancel?: () => void;
  /** Controlled armed state; omit for local state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  arm: ConfirmArm;
  /** Renders the trigger for the current state. Its handler runs on the first press only. */
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

  // Capture outside presses before their target acts; consume Escape so only the prompt closes.
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

  // Measure natural content width without the in-progress animated width.
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
    // Clip changing text to the caller's own border radius while width and colors transition.
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
      // The first paint uses natural width; animation begins only after measurement.
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
