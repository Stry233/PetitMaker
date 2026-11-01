/** Which arrangement the interface takes, upright or wide, read from the device and the window. */
import { raisesKeyboard } from '../input/text-entry';
import { readInputEnv } from './input-mode';
import { viewportSize } from './viewport-space';

/** Which arrangement the interface takes: the upright one or the wide one. */
export type LayoutShape = 'portrait' | 'landscape';

export interface ShapeSignals {
  /** `screen.orientation`'s physical orientation, null where the engine has none. */
  orientation: LayoutShape | null;
  /** The device has no fine pointer. */
  coarse: boolean;
  width: number;
  height: number;
  /** A field that raises a software keyboard holds focus, so the keyboard may be shrinking the viewport. */
  textFocused: boolean;
  previous: LayoutShape;
}

/** How many times longer one side of a window must be than the other to change the shape, so a
 *  resize near square does not flip the arrangement back and forth. */
const SHAPE_MARGIN = 1.1;

/**
 * A coarse device reports its physical orientation, which a software keyboard cannot change. Where
 * it reports none, a focused text field keeps the previous shape, because the keyboard resizes the
 * viewport without rotating anything. Any other window changes shape once it is `SHAPE_MARGIN`
 * times taller than wide, and back once it is that much wider than tall.
 */
export function layoutShapeFor(s: ShapeSignals): LayoutShape {
  if (s.coarse && s.orientation) return s.orientation;
  if (s.coarse && s.textFocused) return s.previous;
  return s.previous === 'landscape'
    ? (s.height > s.width * SHAPE_MARGIN ? 'portrait' : 'landscape')
    : (s.width > s.height * SHAPE_MARGIN ? 'landscape' : 'portrait');
}

/** The physical orientation `screen.orientation` reports; its four types are prefixed `portrait-`
 *  or `landscape-`. Null where the engine has none (older iOS Safari). */
function screenOrientation(): LayoutShape | null {
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  if (!type) return null;
  return type.startsWith('portrait') ? 'portrait' : 'landscape';
}

/** The shape right now, read from the live device. */
export function readLayoutShape(previous: LayoutShape): LayoutShape {
  if (typeof window === 'undefined') return previous;
  const { width, height } = viewportSize();
  return layoutShapeFor({
    orientation: screenOrientation(),
    coarse: !readInputEnv().anyFine,
    width,
    height,
    textFocused: typeof document !== 'undefined' && raisesKeyboard(document.activeElement),
    previous,
  });
}

/** Reports each shape change from rotation, resizing and focus; returns the stop function. */
export function watchLayoutShape(onChange: (shape: LayoutShape) => void, initial: LayoutShape): () => void {
  if (typeof window === 'undefined') return () => {};
  let current = initial;
  const update = (): void => {
    const next = readLayoutShape(current);
    if (next === current) return;
    current = next;
    onChange(next);
  };
  const so = typeof screen !== 'undefined' ? screen.orientation : undefined;
  so?.addEventListener?.('change', update);
  window.addEventListener('orientationchange', update);
  window.addEventListener('resize', update);
  window.addEventListener('focusin', update);
  window.addEventListener('focusout', update);
  return () => {
    so?.removeEventListener?.('change', update);
    window.removeEventListener('orientationchange', update);
    window.removeEventListener('resize', update);
    window.removeEventListener('focusin', update);
    window.removeEventListener('focusout', update);
  };
}
