/*
 * character-state.ts — what the assistant's character is doing, and the pose that says so.
 *
 * ONE STATE MACHINE, so the voice has one place to be tuned. The five states are the spec's, and
 * each is entered from a fact the app already knows: the panel being open and the pointer arriving
 * are the shell's, and a run being in flight, a card landing and a run ending are the agent
 * session's (`agent/session.ts` — `running`, `thinking` and the length of the log). Nothing here
 * introduces a flag of its own, because a second source for "is the assistant working" would drift
 * from the dock's the first time either changed.
 *
 * PURE, and separate from the component that animates it, for the reason every derivation in this
 * project is: the interesting part is the ordering between five states and two dwell windows, and
 * that can be asserted directly rather than through a rendered frame.
 *
 * THE CEILING. The character is one 153x150 drawing, so a state cannot change what is drawn, only
 * how it is transformed. The five are told apart by the KIND of transform — a swing from the feet,
 * a held lean, a squash, a stretch, a quick nod — and each takes the ONE amplitude its registry
 * entry declares, which is how far the character's head moves at the furthest point. Turning that
 * distance into an angle or a scale is geometry off the drawing's rendered height, so the number in
 * the table stays a distance a person can picture and the floor stays checkable in the unit it is
 * written in.
 */
import { MOTIONS, type MotionId } from '../motion/registry';

export type CharacterState = 'rest' | 'attentive' | 'working' | 'reacting' | 'speaking';

/** Which registered motion each state moves on. The mapping is here rather than in the table so the
 *  registry stays a list of motions and the machine stays the list of states. */
export const CHARACTER_MOTION = {
  rest: 'character.rest.sway',
  attentive: 'character.attentive.lean',
  working: 'character.working.pump',
  reacting: 'character.reacting.pop',
  speaking: 'character.speaking.nod',
} as const satisfies Record<CharacterState, MotionId>;

/** What the machine reads. Every field is a fact something else in the app already owns. */
export interface CharacterSignals {
  /** The assistant's own panel is open. */
  panelOpen: boolean;
  /** The pointer is over the character. */
  pointerOver: boolean;
  /** A turn is in flight (`agent/session.ts:running`). */
  running: boolean;
  /** The turn is waiting on the model's first words (`agent/session.ts:thinking`). */
  thinking: boolean;
  /** How many cards the site log holds. A card landing is what the character speaks about. */
  cards: number;
}

/**
 * What the machine remembers between readings.
 *
 * The two transient states are entered by a CHANGE rather than by a condition — a card that was not
 * there a moment ago, a run that has just stopped — so the previous reading has to be kept. It is
 * two booleans and two timestamps; anything more would be a second copy of the session.
 */
export interface CharacterMemory {
  cards: number;
  running: boolean;
  /** When the last run ended, in ms on the same clock `now` is read from. */
  reactedAt: number;
  /** When the last card landed. */
  spokeAt: number;
}

export function initialMemory(signals: CharacterSignals): CharacterMemory {
  return {
    cards: signals.cards,
    running: signals.running,
    // Never, rather than zero: a machine created at ms 0 in a test would otherwise open mid-beat.
    reactedAt: Number.NEGATIVE_INFINITY,
    spokeAt: Number.NEGATIVE_INFINITY,
  };
}

/** Fold one reading into the memory. */
export function observe(prev: CharacterMemory, signals: CharacterSignals, now: number): CharacterMemory {
  return {
    cards: signals.cards,
    running: signals.running,
    // A run that has STOPPED is the result landing. The draft-plan gate stops one too, which is not
    // a mistake: a plan waiting on an answer is a result that has landed.
    reactedAt: prev.running && !signals.running ? now : prev.reactedAt,
    spokeAt: signals.cards > prev.cards ? now : prev.spokeAt,
  };
}

/** The two states that are a beat rather than a condition, and so run out on their own. */
const TRANSIENT: readonly CharacterState[] = ['reacting', 'speaking'];

/**
 * How long a transient state holds, in ms: exactly as long as its own beat takes, since the beat IS
 * the state. Derived rather than declared, so the two cannot be set to disagree.
 *
 * A SECOND TRIGGER INSIDE THE WINDOW PUSHES THE END BACK, it does not start a second beat — the
 * coalescing an informing motion owes, and the reason a turn that pushes six cards in a second is
 * one continuous speaking rather than six collisions.
 */
export function dwellOf(state: CharacterState): number {
  if (!TRANSIENT.includes(state)) return 0;
  const motion = MOTIONS[CHARACTER_MOTION[state]];
  return 'duration' in motion ? motion.duration * 1000 : 0;
}

/**
 * Which state the character is in.
 *
 * The order is the order of how SPECIFIC each fact is to this moment. A run ending outranks a card
 * landing because the last card of a turn lands with the ending and the ending is the larger fact:
 * one beat, not two on top of each other. Both outrank the run itself, which is a condition and
 * will still be there afterwards.
 */
export function characterState(mem: CharacterMemory, signals: CharacterSignals, now: number): CharacterState {
  if (now - mem.reactedAt < dwellOf('reacting')) return 'reacting';
  if (now - mem.spokeAt < dwellOf('speaking')) return 'speaking';
  if (signals.running || signals.thinking) return 'working';
  if (signals.panelOpen || signals.pointerOver) return 'attentive';
  return 'rest';
}

/** How long until a transient state runs out, in ms, or null when none is holding. A caller driving
 *  this off React state needs it: nothing else will wake it when a beat simply expires. */
export function holdRemaining(mem: CharacterMemory, now: number): number | null {
  const ends = [mem.reactedAt + dwellOf('reacting'), mem.spokeAt + dwellOf('speaking')]
    .filter((end) => end > now);
  return ends.length > 0 ? Math.min(...ends) - now : null;
}

/**
 * A transform target for the drawing. Always all three properties, so a state cannot leave one of
 * them where the state before it put it.
 *
 * An array is a keyframe run: first value, middle value, back to the first.
 */
export interface CharacterPose {
  rotate: number | number[];
  scaleX: number | number[];
  scaleY: number | number[];
}

/** Standing straight, at the size it is drawn. */
export const NEUTRAL_POSE: CharacterPose = { rotate: 0, scaleX: 1, scaleY: 1 };

/** The angle that carries the top of a figure `px` sideways when it pivots where it stands. */
function leanDeg(px: number, height: number): number {
  return (Math.asin(Math.max(-1, Math.min(1, px / height))) * 180) / Math.PI;
}

/** The vertical scale that carries the top of a planted figure `px` — negative squashes, positive
 *  stretches — and the horizontal one that keeps its area while it does. Squash and stretch is what
 *  makes a transform read as a body rather than as a picture being scaled. */
function plantedScale(px: number, height: number): { scaleX: number; scaleY: number } {
  const scaleY = 1 + px / height;
  return { scaleX: 1 / scaleY, scaleY };
}

/**
 * The two targets a state has: where it goes when it is allowed to travel, and where it ends up
 * when it is not.
 *
 * `settled` is for an INFORMING motion under reduced motion, which still has to arrive somewhere —
 * `working` sits at the bottom of its pump, which reads as a body down at work and is the fact the
 * loop was carrying. An AMBIENT state is removed under reduced motion rather than settled, so both
 * of its answers are neutral.
 *
 * `reacting` and `speaking` settle at neutral because they are PURE TRAVEL: a beat that ends where
 * it began has nothing left when the travel is taken away, so under reduced motion neither is
 * visible at all. That is the correct outcome and not a gap — the card landing in the log is the
 * static carrier both of them underline, and an informing motion is required to have one.
 *
 * `height` is the drawing's rendered height in css px, which is what turns the declared distance
 * into the angle or scale that delivers it.
 */
export function poseFor(state: CharacterState, height: number): { travelling: CharacterPose; settled: CharacterPose } {
  const amplitude = MOTIONS[CHARACTER_MOTION[state]].amplitude;
  switch (state) {
    case 'rest': {
      const deg = leanDeg(amplitude, height);
      return { travelling: { ...NEUTRAL_POSE, rotate: [-deg, deg, -deg] }, settled: NEUTRAL_POSE };
    }
    case 'attentive':
      return { travelling: { ...NEUTRAL_POSE, rotate: leanDeg(amplitude, height) }, settled: NEUTRAL_POSE };
    case 'working': {
      const down = plantedScale(-amplitude, height);
      return {
        travelling: { rotate: 0, scaleX: [1, down.scaleX, 1], scaleY: [1, down.scaleY, 1] },
        settled: { rotate: 0, ...down },
      };
    }
    case 'reacting': {
      const up = plantedScale(amplitude, height);
      return {
        travelling: { rotate: 0, scaleX: [1, up.scaleX, 1], scaleY: [1, up.scaleY, 1] },
        settled: NEUTRAL_POSE,
      };
    }
    case 'speaking': {
      const deg = leanDeg(amplitude, height);
      return { travelling: { ...NEUTRAL_POSE, rotate: [0, deg, 0] }, settled: NEUTRAL_POSE };
    }
  }
}
