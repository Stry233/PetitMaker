/*
 * Wavy — the app's ONE emphasis underline: a yellow wave travelling under a word.
 *
 * It lives here rather than in `agent/atoms.tsx` (its first home) because the whole Site Log UI is
 * a lazy chunk, and the first-launch tour is in the main bundle: importing it from atoms would pull
 * that chunk's atoms + markdown renderer into the main bundle for one underline.
 *
 * The travel itself is `.pw-wavy` in ui/animations.css, so reduced motion freezes it there with
 * every other looping decoration while the underline stays visible.
 */
import type { CSSProperties, ReactNode } from 'react';
import { usePx } from './scale';

/** Inline style + `--pw-*` custom properties (React's CSSProperties has no index signature for
 *  custom props). */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/** Prototype wave tile: 7×6 css px → 14×12 design px, 2px→4px round stroke.
 *  The SVG itself stays in its 7×6 coordinate space; background-size scales it.
 *  Spaces and quotes are percent-encoded (same rendering; strict CSS value
 *  parsers reject raw spaces/quotes inside url()). */
const waveUri = (strokeHex: string) =>
  `url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%277%27%20height=%276%27%20viewBox=%270%200%207%206%27%3E%3Cpath%20d=%27M0%203%20Q1.75%200.4%203.5%203%20T7%203%27%20fill=%27none%27%20stroke=%27%23${strokeHex}%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E")`;

/** Yellow traveling wavy underline (one period per 1.2s). `dimmed` (undone
 *  entries) freezes it and greys the stroke; reduced motion freezes it too
 *  (media query in animations.css) while the underline stays visible. */
export function Wavy({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  const { px } = usePx();
  const style: PwStyle = {
    paddingBottom: px(6),
    marginBottom: px(-2),
    backgroundImage: waveUri(dimmed ? 'C9C2B4' : 'FFDA7E'),
    '--pw-wave-size': `${px(14)}px ${px(12)}px`,
    '--pw-wave-period': `${px(14)}px`,
  };
  return (
    <span className={`pw-wavy${dimmed ? ' pw-dimmed' : ''}`} style={style}>
      {children}
    </span>
  );
}
