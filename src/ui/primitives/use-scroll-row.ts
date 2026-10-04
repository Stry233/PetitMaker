import type { CSSProperties, RefObject } from 'react';
import { useScrollFade } from './scroll-fade';
import { useWheelToHorizontal } from './wheel-horizontal';

type Bleed = number | string | { top: number; right: number; bottom: number; left: number };

/** The focus ring and optional halo share their extent with clipping containers. */
export const CONTROL_CLEARANCE = 'var(--control-clearance)';

/** Padding admits visual overhang; matching negative margins preserve the surface's layout box. */
export function scrollBleed(bleed: Bleed): CSSProperties {
  if (typeof bleed === 'number') return { padding: bleed, margin: -bleed };
  if (typeof bleed === 'string') return { padding: bleed, margin: `calc(0px - ${bleed})` };
  const values = [bleed.top, bleed.right, bleed.bottom, bleed.left];
  return { padding: values.map((n) => `${n}px`).join(' '), margin: values.map((n) => `${-n}px`).join(' ') };
}

export function useScrollRow(ref: RefObject<HTMLElement | null>, { zoom, bleed, pointerEvents, fade }: {
  zoom: number;
  bleed?: Bleed;
  pointerEvents: 'auto' | 'none';
  fade?: Parameters<typeof useScrollFade>[2];
}): CSSProperties {
  useWheelToHorizontal(ref, { zoom, smooth: true });
  const edgeFade = useScrollFade(ref, 'x', fade);
  return { overflowX: 'auto', overflowY: 'hidden', pointerEvents, ...(bleed === undefined ? {} : scrollBleed(bleed)), ...edgeFade };
}
