/**
 * A fill a hover tints, owned by Framer. A value Framer has animated stops following `style`, so the
 * resting fill of anything with a hover fill is Framer's `animate` target: drawn through `style`, it
 * would stay at whatever the first hover returned to.
 */
import type { TargetAndTransition, Transition } from 'framer-motion';
import { clearOf } from '../design/tokens';

/** A value Framer can animate to as a colour. */
const COLOUR = /^(#[0-9a-f]{6}|rgba?\([^)]*\))$/i;

/** The Framer props of a resting `fill` and the `hoverFill` a hover tints it to. A resting value
 *  that is no colour (`transparent`, `none`, absent) rests at the hover fill's clear. */
export function hoverFillMotion({ fill, hoverFill, transition }: { fill?: string; hoverFill?: string; transition?: Transition }): {
  initial: false; animate?: TargetAndTransition; whileHover: TargetAndTransition;
} {
  const resting = fill !== undefined && COLOUR.test(fill) ? fill : hoverFill !== undefined && COLOUR.test(hoverFill) ? clearOf(hoverFill) : fill;
  return {
    initial: false,
    ...(resting === undefined ? {} : { animate: { backgroundColor: resting, ...(transition ? { transition } : {}) } }),
    whileHover: hoverFill === undefined ? {} : { backgroundColor: hoverFill },
  };
}

/** Development builds name a button that draws its resting fill through `style` beside a hover fill. */
export function reportStyleFill(style: { background?: unknown; backgroundColor?: unknown } | undefined, label: string): void {
  if (!import.meta.env.DEV) return;
  const drawn = style?.backgroundColor ?? style?.background;
  if (drawn !== undefined) console.error(`[ui] ${label} has a hoverFill and draws its resting fill (${String(drawn)}) through style; pass it as fill.`);
}
