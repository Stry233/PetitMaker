import { useEffect, useState } from 'react';
import { useEffectEvent } from './use-effect-event';

/** One cue of a walk: when it lands in its step, in ms from the step's start, what it does, and on
 *  which steps: every `every`-th, counting the first step as one (absent, every step). */
type WalkCue = readonly [at: number, run: () => void, every?: number];

interface WalkOptions {
  /** How long one step stands, in ms. */
  beatMs: number;
  /** Whether the walk plays; a caller under reduced motion passes false and keeps its settled pose. */
  active: boolean;
  /** How many steps the walk loops through, a multiple of every cue's `every`; absent, the step
   *  counts up from 0 and never wraps. */
  length?: number;
  /** A new value schedules the standing step's cues again from now. */
  restartOn?: unknown;
  /** A new value starts the walk over at its first step. */
  resetOn?: unknown;
}

/**
 * A scripted walk: a step counter that advances every `beatMs` while `active`, and the step's own
 * cues, read from the latest `cues` at the step's start, scheduled from it on timers and cancelled
 * when the step, the walk, `restartOn` or `resetOn` change. Nothing runs between cues.
 */
export function useScriptedWalk({ beatMs, active, length, restartOn, resetOn }: WalkOptions, cues: (step: number) => readonly WalkCue[]): number {
  const [walk, setWalk] = useState({ from: resetOn, step: 0 });
  const counted = Object.is(walk.from, resetOn) ? walk.step : 0;
  const step = length === undefined ? counted : counted % length;
  useEffect(() => {
    setWalk((w) => (Object.is(w.from, resetOn) ? w : { from: resetOn, step: 0 }));
    if (!active) return undefined;
    const timer = setInterval(() => setWalk((w) => {
      const next = (Object.is(w.from, resetOn) ? w.step : 0) + 1;
      return { from: resetOn, step: length === undefined ? next : next % length };
    }), beatMs);
    return () => clearInterval(timer);
  }, [active, length, beatMs, resetOn]);
  const cuesOf = useEffectEvent(cues);
  useEffect(() => {
    if (!active) return undefined;
    const timers = cuesOf(step)
      .filter(([, , every = 1]) => (step + 1) % every === 0)
      .map(([at, run]) => setTimeout(run, at));
    return () => timers.forEach(clearTimeout);
  }, [step, active, restartOn, resetOn]);
  return step;
}
