/** Shared animated emphasis underline. Keeping it in primitives prevents the main-bundle tour from
 * importing the lazy assistant chunk. Reduced motion freezes the wave but keeps it visible. */
import type { CSSProperties, ReactNode } from 'react';
import { usePx } from '../design/scale';

/** Inline style + `--pw-*` custom properties (React's CSSProperties has no index signature for
 *  custom props). */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/** Wave tile: 7×6 CSS pixels scaled to 14×12 design pixels with a 2px round stroke.
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
