/*
 * A stepped slider's input, whatever draws it: a press or drag reports each stop it reaches once, arrow
 * keys step, Home and End go to the ends, and the knob's place glides past React (`use-slider-glide.ts`).
 * The reading stands while the slider is hovered, focused or dragged. A slider that is `off` reports
 * nothing, answers no key and leaves the tab order, and still shows its reading, where its reason goes.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { clientPoint } from '../../platform/device/viewport-space';
import { visualRect } from '../design/visual-rect';
import type { MotionId } from '../design/motion/registry';
import { useSliderGlide } from './use-slider-glide';

export function useSliderInput<E extends HTMLElement>({
  min, max, value, onChange, label, valueText, off = false, nudge = 1, track, elsewhere, onRelease, onKeyDown, aria,
}: {
  min: number;
  max: number;
  value: number;
  /** A stop reached by a press, a drag or a key, once per stop. */
  onChange: (v: number) => void;
  label: string;
  /** What the value reads as, announced in place of the number. */
  valueText?: string;
  off?: boolean;
  /** How many stops an arrow key steps. */
  nudge?: number;
  /** The element whose box the stops span from end to end; the slider's own where omitted. */
  track?: RefObject<HTMLElement | null>;
  /** The motion a value set from elsewhere glides on (`useSliderGlide`). */
  elsewhere?: MotionId;
  /** The press or drag ending. */
  onRelease?: () => void;
  /** Answers keys in place of the slider's own stepping. */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** The numbers announced where the value is not what the reading counts (a percentage). */
  aria?: { min: number; max: number; now: number };
}) {
  const ref = useRef<E>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const held = useRef(false);
  const steps = Math.max(1, max - min);
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  const current = clamp(value);
  const share = (current - min) / steps;
  const glide = useSliderGlide(share, elsewhere);
  // The value last reported: each report is a store update every subscriber hears, so a drag reports a
  // stop as it crosses it, not on every pointer move.
  const reported = useRef(current);
  useLayoutEffect(() => { reported.current = current; }, [current]);
  const set = (v: number): void => {
    const next = clamp(v);
    if (next === reported.current) return;
    reported.current = next;
    glide.own((next - min) / steps);
    onChange(next);
  };
  // Measured as a share of the track's rect: rects and pointers are both in screen px under the zoom.
  const pick = (e: PointerEvent): void => {
    if (off) return;
    const el = track?.current ?? ref.current;
    const rect = el ? visualRect(el) : null;
    if (!rect || rect.width === 0) return;
    set(min + Math.round(Math.min(1, Math.max(0, (clientPoint(e).x - rect.left) / rect.width)) * steps));
  };
  const release = (): void => {
    if (!held.current) return;
    held.current = false;
    setDragging(false);
    onRelease?.();
  };

  const props = {
    ref,
    role: 'slider',
    tabIndex: off ? -1 : 0,
    'aria-label': label,
    'aria-disabled': off || undefined,
    'aria-valuemin': aria?.min ?? min,
    'aria-valuemax': aria?.max ?? max,
    'aria-valuenow': aria?.now ?? current,
    ...(valueText !== undefined ? { 'aria-valuetext': valueText } : {}),
    onPointerDown: (e: PointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      held.current = true;
      setDragging(true);
      pick(e);
    },
    onPointerMove: (e: PointerEvent) => { if (e.buttons) pick(e); },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onKeyDown: (e: KeyboardEvent) => {
      if (onKeyDown) { onKeyDown(e); return; }
      if (off) return;
      const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? current + nudge
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? current - nudge
          : e.key === 'Home' ? min : e.key === 'End' ? max : null;
      if (to === null) return;
      e.preventDefault();
      set(to);
    },
  } as const;

  return { props, ref, current, share, glide, reading: hovered || focused || dragging };
}
