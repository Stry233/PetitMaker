/**
 * A keyed arrival that travels in from aside (a shelf's category swap) moves its box past where it
 * will stand, and a transformed box still counts toward its scroller's scrollable overflow: the
 * scroller would grow a scroll range, a scrollbar and edge fades for the length of the travel. The
 * box the arrival stands in clips while it plays, and only then, so a hovered card's growth and a
 * focus ring are not clipped at rest. Reduced motion has no travel to clip.
 */
import { useState, type CSSProperties } from 'react';
import { useReducedMotionConfig } from 'framer-motion';

interface SwapClip {
  /** Spread on the box the arriving element stands in, which the travel must not overflow. */
  clip: CSSProperties;
  /** Pass to the arriving element's `onAnimationComplete` (or its `transitionend`). */
  settle: () => void;
}

/** Which axes a travelling arrival's box clips: `inline`, the axis it travels along, so an overhang
 *  above or below (a chosen card's plate, a lifted card) stays drawn; `block`, for a box whose
 *  leaving content, taken out of the flow, may stand taller than what replaces it while the travel
 *  runs past its sides; or `both`. */
type ClipAxes = 'inline' | 'block' | 'both';

/** An engine without `overflow-x: clip` (Chrome before 90, Safari before 16) clips an inline clip on
 *  both axes and draws a block clip whole. */
function axesClip(axes: ClipAxes): CSSProperties {
  if (axes === 'both') return { overflow: 'hidden' };
  const clips = typeof CSS !== 'undefined' && CSS.supports?.('overflow-x', 'clip');
  if (axes === 'block') return clips ? { overflowY: 'clip' } : {};
  return clips ? { overflowX: 'clip' } : { overflow: 'hidden' };
}

/** `key` is the arrival's key: each change of it clips until `settle` reports that arrival done, a
 *  return to an earlier key included. `fromRest` takes the first key as already standing, for an
 *  arrival that does not play on mount. */
export function useSwapClip(key: string, { fromRest = false, axes = 'inline' }: { fromRest?: boolean; axes?: ClipAxes } = {}): SwapClip {
  const reduced = useReducedMotionConfig() === true;
  // `turn` counts key changes, so a settle reported for an earlier arrival never ends a later one.
  const [state, setState] = useState({ key, turn: 0, settled: fromRest });
  let shown = state;
  if (state.key !== key) {
    shown = { key, turn: state.turn + 1, settled: false };
    setState(shown);
  }
  const { turn } = shown;
  const travelling = !reduced && !shown.settled;
  return {
    clip: travelling ? axesClip(axes) : {},
    settle: () => setState((was) => (was.turn === turn && !was.settled ? { ...was, settled: true } : was)),
  };
}
