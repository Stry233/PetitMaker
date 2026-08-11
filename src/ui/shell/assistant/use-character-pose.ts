/*
 * use-character-pose.ts — the character's state machine, wired to the app and to the registry.
 *
 * The machine itself is `character-state.ts` and is pure. This is the part that cannot be: the
 * signals it reads live in two stores, a beat that simply expires needs something to wake the
 * component, and which of a state's two poses applies is a question about the person looking at it.
 *
 * WHY THE HOOK AND NOT THE FRAME. A turn pushes a card at a time and sets `thinking` on and off
 * around every one of them, so whatever subscribes to the session re-renders through the whole run.
 * That is this hook's caller and nothing above it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionConfig, type TargetAndTransition } from 'framer-motion';
import { useAgentSession } from '../../../agent/session';
import { ASSISTANT_BLOCK } from '../frame';
import { loopedOverTarget, useMotion, useMotionAllowed } from '../motion/use-motion';
import { MODE_SCALE } from '../units';
import {
  CHARACTER_MOTION, NEUTRAL_POSE, characterState, holdRemaining, initialMemory, observe, poseFor,
  type CharacterPose, type CharacterSignals, type CharacterState,
} from './character-state';

/** What the drawing needs to move, and what the block it stands in needs to report the pointer. */
export interface CharacterMotionProps {
  state: CharacterState;
  animate: TargetAndTransition;
  transition: Record<string, unknown>;
  hover: { onPointerEnter: () => void; onPointerLeave: () => void };
}

/** The machine's pose as something Framer will take. Spelt out rather than passed through, because
 *  a Framer target is an open bag of keys and the machine's is deliberately three. */
function asTarget(pose: CharacterPose): TargetAndTransition {
  return { rotate: pose.rotate, scaleX: pose.scaleX, scaleY: pose.scaleY };
}

/** The drawing's rendered height in css px, which the declared amplitudes are turned into angles
 *  and scales against. The two states differ by a tenth, far less than the eye reads in a lean, so
 *  the pose is measured on whichever one is on screen and neither has to be special-cased. */
function drawnHeight(open: boolean): number {
  return (open ? ASSISTANT_BLOCK.selected.h : ASSISTANT_BLOCK.h) * MODE_SCALE;
}

export function useCharacterPose(open: boolean): CharacterMotionProps {
  const running = useAgentSession((s) => s.running);
  const thinking = useAgentSession((s) => s.thinking);
  const cards = useAgentSession((s) => s.log.length);
  const [pointerOver, setPointerOver] = useState(false);

  const signals: CharacterSignals = { panelOpen: open, pointerOver, running, thinking, cards };
  const memory = useRef(initialMemory(signals));
  const [state, setState] = useState<CharacterState>('rest');

  useEffect(() => {
    const now = Date.now();
    memory.current = observe(memory.current, { panelOpen: open, pointerOver, running, thinking, cards }, now);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Re-read on a clock as well as on a signal, because a beat ENDS without anything changing:
    // nothing in either store moves when a dwell window simply runs out.
    const settle = () => {
      const at = Date.now();
      setState(characterState(memory.current, { panelOpen: open, pointerOver, running, thinking, cards }, at));
      const left = holdRemaining(memory.current, at);
      if (left !== null) timer = setTimeout(settle, left);
    };
    settle();
    return () => clearTimeout(timer);
  }, [open, pointerOver, running, thinking, cards]);

  const motion = CHARACTER_MOTION[state];
  const runs = useMotionAllowed(motion);
  const transition = useMotion(motion);
  const reduced = useReducedMotionConfig();
  const pose = poseFor(state, drawnHeight(open));

  const onPointerEnter = useCallback(() => setPointerOver(true), []);
  const onPointerLeave = useCallback(() => setPointerOver(false), []);

  // Three answers, one line: a motion that is withheld leaves the character standing straight, a
  // motion that may not travel arrives at where it was going, and everything else moves.
  const animate = asTarget(!runs ? NEUTRAL_POSE : reduced ? pose.settled : pose.travelling);

  return {
    state,
    animate,
    // A state that loops loops the values it wrote as keyframes. The ones it did not are on their
    // way in from the state before, and they arrive rather than arriving over and over.
    transition: loopedOverTarget(transition, animate),
    hover: { onPointerEnter, onPointerLeave },
  };
}
