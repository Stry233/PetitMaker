import { useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { graphemes } from '../../../core/base/text';
import { seconds, staggerDelay } from '../../design/motion';

/** Reveals appended text while keeping mounted history and replacement transcripts immediately readable. */
export function useStreamedText(text: string, streaming: boolean): string {
  const reduced = useReducedMotionConfig() === true;
  const [visible, setVisible] = useState(text);
  const painted = useRef(text);
  const previous = useRef(text);
  const paintedAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const appended = text.startsWith(previous.current);
    previous.current = text;
    if (!streaming || reduced || !appended) {
      painted.current = text;
      paintedAt.current = null;
      setVisible(text);
      return;
    }
    if (painted.current === text) return;

    let offset = painted.current.length;
    const ends = graphemes(text.slice(offset)).map(char => (offset += char.length));
    const span = Math.min(seconds('panel.thoughts.stream') * 1000, ends.length * (staggerDelay('panel.thoughts.stream', 1) * 1000));
    // Retargeting before a frame must not restart the first character's wait.
    const started = paintedAt.current ?? performance.now();
    paintedAt.current = started;
    let shown = 0;
    let frame: number;
    const tick = (now: number) => {
      const count = Math.min(ends.length, Math.floor(ends.length * (now - started) / span));
      if (count > shown) {
        shown = count;
        painted.current = text.slice(0, ends[count - 1]);
        paintedAt.current = now;
        setVisible(painted.current);
      }
      if (count < ends.length) frame = requestAnimationFrame(tick);
      else paintedAt.current = null;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, streaming, reduced]);

  return visible;
}
