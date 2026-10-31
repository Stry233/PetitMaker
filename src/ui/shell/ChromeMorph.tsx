/**
 * The frame's chrome morphs from its old arrangement into its new one when the layout shape flips or
 * the input mode switches: the pieces are measured in that commit before the DOM changes, and drawn
 * into their new boxes once the new arrangement is laid out, before it is painted
 * (`primitives/morph.ts`). The mode's sizes, the UI zoom it brings and the arrangement it plans all
 * land in that one commit, so the re-size runs on Web Animations with nothing re-laid out or rendered
 * on its frames. React renders nothing for it; a resize that keeps the shape morphs nothing, and
 * reduced motion re-arranges at once.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import type { InputMode } from '../../platform/device/input-mode';
import type { LayoutShape } from '../../platform/device/layout-shape';
import { useCurrentInputMode, useLayoutShape } from '../design/input-mode';
import type { MotionId } from '../design/motion/registry';
import { useUiPreview } from '../design/preview';
import { useViewportSize } from '../design/scale';
import { measureMorph, playMorph, stopMorph, watchShownBoxes, type MorphFirst } from '../primitives/morph';
import { MorphOnChange } from '../primitives/MorphOnChange';

/** How long a flip waits, held where it stood, for the window to turn to its shape: a device reports
 *  its turn before the window takes the new size. */
const TURN_WAIT_MS = 400;

export function ChromeMorph({ children }: { children: ReactNode }) {
  const shape = useLayoutShape();
  const inputMode = useCurrentInputMode();
  const { w, h } = useViewportSize();
  const reduced = useReducedMotionConfig() === true;
  const preview = useUiPreview();
  // What the screen last showed, for a turn whose resize lands before the morph measures.
  useEffect(() => (preview || reduced ? undefined : watchShownBoxes()), [preview, reduced]);
  return (
    <MorphOnArrange shape={shape} inputMode={inputMode} turned={shape === 'portrait' ? h > w : w >= h} still={reduced || preview}>
      {children}
    </MorphOnArrange>
  );
}

interface ArrangeProps {
  shape: LayoutShape;
  inputMode: InputMode;
  /** The window already has the shape's proportions. */
  turned: boolean;
  still: boolean;
  children: ReactNode;
}

/** A re-arrangement measured, with the motion that carries it: a shape flip's, or the mode's re-size. */
interface Arranged { first: MorphFirst; motion: MotionId }

/** A flip measured and not yet played, while the window has still to turn. */
interface Waiting { arranged: Arranged; timer: ReturnType<typeof setTimeout> }

/** Morphs each change of `shape` or `inputMode`; a flip committed before the window has turned is held
 *  where the pieces stood until it turns, or until `TURN_WAIT_MS` has passed, and played from there. */
function MorphOnArrange({ shape, inputMode, turned, still, children }: ArrangeProps) {
  const flip = useRef<MorphOnChange<Arranged>>(null);
  const waiting = useRef<Waiting | null>(null);
  const shown = useRef(shape);
  const settle = () => {
    if (waiting.current) clearTimeout(waiting.current.timer);
    waiting.current = null;
  };
  const release = () => {
    const arranged = waiting.current?.arranged;
    settle();
    if (arranged) flip.current?.replay(arranged);
  };
  useLayoutEffect(() => { if (turned && waiting.current) release(); });
  useLayoutEffect(() => { shown.current = shape; }, [shape]);
  useLayoutEffect(() => () => { if (waiting.current) clearTimeout(waiting.current.timer); }, []);
  return (
    <MorphOnChange<Arranged>
      ref={flip}
      change={`${shape}:${inputMode}`}
      measure={() => (still ? null : { first: measureMorph(), motion: shown.current !== shape ? 'shell.shape.morph' : 'shell.mode.resize' })}
      committed={(arranged) => {
        settle();
        if (!turned) waiting.current = { arranged, timer: setTimeout(release, TURN_WAIT_MS) };
      }}
      play={(arranged) => {
        // Size observers report the new arrangement after the first frame's animation callbacks, and
        // what they re-lay out commits before the next, where the pass reads the page again and sets off.
        playMorph(arranged.first, arranged.motion, { held: waiting.current?.arranged === arranged, late: true });
      }}
      stop={stopMorph}
    >
      {children}
    </MorphOnChange>
  );
}
