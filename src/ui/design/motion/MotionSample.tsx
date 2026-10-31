import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { seconds } from '.';
import { CSS_CURVES } from './curves';
import { MOTIONS, type SampleKey, type SampleMotionId } from './registry';

export type SampleLevel = 'full' | 'reduced';

/** The ground mark's opacity at its resting scale; a squash's wider mark darkens towards 1. */
const GROUND_REST = 0.8;

/**
 * The start time every playing sample shares, so every loop on the page runs in phase. Taken from the
 * document timeline when the first sample mounts and dropped when the last one leaves; a sample that
 * restarts while others play joins their beat.
 */
let shared: { epoch: CSSNumberish | null; members: number } = { epoch: null, members: 0 };

function joinBeat(): CSSNumberish | null {
  if (shared.members++ === 0) shared.epoch = document.timeline?.currentTime ?? null;
  return shared.epoch;
}

function leaveBeat(): void {
  if (--shared.members === 0) shared = { epoch: null, members: 0 };
}

/** The easing from `from` to the next key: a rise and a fall take the entry's curves, a level segment eases. */
function segmentEasing(from: SampleKey, to: SampleKey | undefined, rise: string, fall: string): string {
  if (!to || to[1] === from[1]) return CSS_CURVES.ease;
  return to[1] > from[1] ? rise : fall;
}

function frames(id: SampleMotionId, level: SampleLevel): { mover: Keyframe[]; ground: Keyframe[] } {
  const m = MOTIONS[id];
  const keys = m.tracks[level];
  const rise = CSS_CURVES[m.curve];
  const fall = CSS_CURVES[m.fallCurve];
  const mover: Keyframe[] = [];
  const ground: Keyframe[] = [];
  keys.forEach((k, i) => {
    const [at, lift, sx, sy, mark] = k;
    const easing = segmentEasing(k, keys[i + 1], rise, fall);
    mover.push({ offset: at, easing, transform: `translateY(${-lift * m.amplitude}px) scale(${sx}, ${sy})` });
    ground.push({ offset: at, easing, transform: `scale(${mark})`, opacity: Math.min(1, mark * GROUND_REST) });
  });
  return { mover, ground };
}

const box: CSSProperties = { position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center' };

/**
 * Plays a registered sample motion's `level` loop under every reduced-motion preference: `children`
 * moves and `ground`, the mark beneath it, scales and fades with its height. The loops are Web
 * Animations, which no reduced-motion gate reaches, so surrounding feedback still obeys the app's gate.
 * Every sample on the page keeps one beat. Where Web Animations are missing the sample stands at rest,
 * `seat` px above the bottom of the box `style` sizes.
 */
export function MotionSample({ id, level, seat, style, ground, children }: {
  id: SampleMotionId; level: SampleLevel; seat: number; style: CSSProperties; ground: ReactNode; children: ReactNode;
}) {
  const moverRef = useRef<HTMLSpanElement>(null);
  const groundRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const mover = moverRef.current;
    const mark = groundRef.current;
    if (!mover || !mark || typeof mover.animate !== 'function') return;
    const track = frames(id, level);
    const timing: KeyframeAnimationOptions = { duration: seconds(id) * 1000, iterations: MOTIONS[id].loop ? Infinity : 1 };
    const playing = [mover.animate(track.mover, timing), mark.animate(track.ground, timing)];
    const epoch = joinBeat();
    if (epoch !== null) for (const a of playing) a.startTime = epoch;
    return () => {
      for (const a of playing) a.cancel();
      leaveBeat();
    };
  }, [id, level]);
  return (
    <span data-motion-sample={id} data-sample-level={level} style={{ position: 'relative', display: 'block', ...style }} aria-hidden>
      <span ref={groundRef} style={{ ...box, bottom: 0, opacity: GROUND_REST }}>{ground}</span>
      <span ref={moverRef} style={{ ...box, bottom: seat, transformOrigin: '50% 100%' }}>{children}</span>
    </span>
  );
}
