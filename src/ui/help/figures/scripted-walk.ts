import { useEffect, useState } from 'react';
import { useEffectEvent } from '../../primitives/use-effect-event';

/** One cue of a pictured walk: when it lands in its step, in ms from the step's start, and what it does. */
export type Beat = readonly [at: number, run: () => void];

/**
 * The timeline the Help figures' walk-throughs share: a looping step counter that advances every
 * `beatMs` while `active`, and the step's own beats, read from the latest `beats` at the step's start,
 * scheduled from it and cancelled when the step, the figure or `restartOn` change. A figure under
 * reduced motion passes `active` false and keeps its settled pose.
 */
export function useScriptedWalk(length: number, beatMs: number, active: boolean, beats: (step: number) => readonly Beat[], restartOn: unknown): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setStep((n) => (n + 1) % length), beatMs);
    return () => clearInterval(timer);
  }, [active, length, beatMs]);
  const beatsOf = useEffectEvent(beats);
  useEffect(() => {
    if (!active) return undefined;
    const timers = beatsOf(step).map(([at, run]) => setTimeout(run, at));
    return () => timers.forEach(clearTimeout);
  }, [step, active, restartOn]);
  return step;
}
