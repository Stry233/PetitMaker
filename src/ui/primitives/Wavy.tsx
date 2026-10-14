/** Shared animated emphasis underline. Keeping it in primitives prevents the main-bundle tour from
 * importing the lazy assistant chunk. Reduced motion freezes the wave but keeps it visible. */
import type { ReactNode } from 'react';
import { useDevicePixelRatio } from '../design/scale';
import type { PwStyle } from '../design/styles';

/** The wave tile and the room under the words, in css px. */
const WAVE = { w: 7.84, h: 6.72, pad: 3.36, pull: -1.12 } as const;

/** Wave tile: a 7×6 drawing laid out at `WAVE` css px with a 2-unit round stroke.
 *  The SVG itself stays in its 7×6 coordinate space; background-size scales it.
 *  Spaces and quotes are percent-encoded (same rendering; strict CSS value
 *  parsers reject raw spaces/quotes inside url()). */
const waveUri = (strokeHex: string) =>
  `url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%277%27%20height=%276%27%20viewBox=%270%200%207%206%27%3E%3Cpath%20d=%27M0%203%20Q1.75%200.4%203.5%203%20T7%203%27%20fill=%27none%27%20stroke=%27%23${strokeHex}%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E")`;

/** Yellow traveling wavy underline (one period per 1.2s). `dimmed` (undone
 *  entries) freezes it and greys the stroke; reduced motion freezes it too
 *  (media query in animations.css) while the underline stays visible. */
export function Wavy({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  const dpr = useDevicePixelRatio();
  // Lengths land on whole device pixels so the wave repeats without a seam.
  const device = (n: number) => Math.round(n * dpr) / dpr;
  const style: PwStyle = {
    paddingBottom: device(WAVE.pad),
    marginBottom: device(WAVE.pull),
    backgroundImage: waveUri(dimmed ? 'C9C2B4' : 'FFDA7E'),
    '--pw-wave-size': `${device(WAVE.w)}px ${device(WAVE.h)}px`,
    '--pw-wave-period': `${device(WAVE.w)}px`,
  };
  return (
    <span className={`pw-wavy${dimmed ? ' pw-dimmed' : ''}`} style={style}>
      {children}
    </span>
  );
}
