/*
 * choreography.ts — a multi-element move, as data.
 *
 * A mode switch is not one motion. The outgoing bar leaves, the incoming one arrives, the plate
 * moves, the name changes. Writing that as a score rather than as four independent transitions is
 * what lets the order be READ, and what stops a later change to one element quietly desynchronising
 * it from the other three.
 *
 * `at` is milliseconds from the ANCHOR, which is the beat at zero. The plate is the anchor for the
 * mode switch: it is the element that says what happened, and everything else follows it.
 */
import type { MotionId } from './registry';

export interface Beat {
  /** What moves. A name a reader can find in the shell, not a selector. */
  target: string;
  motion: MotionId;
  /** Milliseconds after the anchor. */
  at: number;
}

export interface Choreography {
  beats: readonly Beat[];
}

/**
 * The bar's own two moments, which the screen's shading shares.
 *
 * Named rather than typed twice because the shading is not a second event: it is the seam under
 * that surface, so it must not arrive before there is a surface or leave while one is still there.
 * Written as two literals the pair drifts the first time either bar beat is retimed, and what a
 * person then sees is shading over bare map.
 */
const BAR_IN = 60;
const BAR_OUT = 160;

export const SCORES = {
  'mode.switch': {
    beats: [
      { target: 'plate.arriving', motion: 'mode.plate.arrive', at: 0 },
      /** The old ground goes at once rather than lingering under a block that is no longer chosen.
       *  The two plates CROSS: separated in time they read as two events, and the switch is one. */
      { target: 'plate.leaving', motion: 'mode.plate.leave', at: 0 },
      { target: 'caption', motion: 'mode.caption.swap', at: 0 },
      /** Behind the one it replaces, so the two bars are a handover rather than a dissolve. Short
       *  enough that the arriving bar is still on its way while the plate is. */
      { target: 'bar.arriving', motion: 'mode.bar.enter', at: BAR_IN },
      /**
       * THE OLD BAR WAITS UNDER THE NEW ONE, which is what stops the handover showing a hole.
       *
       * Two bars stand in the same place, so what a person sees is the union of their two
       * opacities: measured in the browser with the old leaving at the anchor, the whole bottom of
       * the screen dropped to 44% a tenth of a second in and came back, which reads as a flash
       * rather than as a change. Held until the arriving one is most of the way up, the union never
       * falls below about 0.93 and the old bar dissolves under a bar that is already there.
       */
      { target: 'bar.leaving', motion: 'mode.bar.leave', at: BAR_OUT },
      /**
       * THE SCREEN'S SHADING RIDES THE BAR, and that is the whole of its timing.
       *
       * It is not a thing of its own: the map darkens at the bottom because a full-width shelf
       * meets it there (`tokens.ts:EDGE_VIGNETTE`), so the shading is the seam under that surface.
       * On its own clock it would either shade an edge with nothing at it or leave one lit while a
       * shelf stands on it, and both are the shading saying something untrue.
       *
       * At rest there is no shelf, so the two moments are the only ones it has: it rises as the
       * first bar arrives and drops as the last one leaves. A switch BETWEEN two modes never moves
       * it, since a shelf is standing there throughout.
       */
      { target: 'vignette.arriving', motion: 'screen.seam.shade', at: BAR_IN },
      { target: 'vignette.leaving', motion: 'screen.seam.shade', at: BAR_OUT },
    ],
  },
  /**
   * The saved session being offered, which is the first thing a returning visitor sees.
   *
   * THE PICTURE IS THE ANCHOR, because the picture is the offer: what is being said is "here is the
   * island you left", and the words and the two answers are about it. Read in that order they are
   * a photograph put down, a sentence about it, and what may be done with it; arriving together
   * they are a panel appearing.
   *
   * The plate comes with the card rather than before it. It is the ground the photograph stands on
   * and it holds nothing else, so a plate that arrived first would be an empty shelf for a beat —
   * which is exactly the sixth mode the offer must never read as.
   */
  'restore.offer': {
    beats: [
      { target: 'plinth', motion: 'restore.offer.arrive', at: 0 },
      { target: 'card', motion: 'restore.card.arrive', at: 0 },
      { target: 'words', motion: 'restore.words.arrive', at: 90 },
      { target: 'answers', motion: 'restore.words.arrive', at: 150 },
    ],
  },
} as const satisfies Record<string, Choreography>;

export type ScoreId = keyof typeof SCORES;

/** Which target names a score has. Derived from the table, so a beat that is renamed makes every
 *  reader of the old name a compile error rather than a silent no-op. */
export type BeatTarget<S extends ScoreId> = (typeof SCORES)[S]['beats'][number]['target'];

export function beatsOf(id: ScoreId): readonly Beat[] {
  return SCORES[id].beats;
}

/** One beat by name. The type guarantees it is there; the throw is what makes that true at runtime
 *  for a caller that reached this through a cast. */
export function beatOf<S extends ScoreId>(score: S, target: BeatTarget<S>): Beat {
  const beat = beatsOf(score).find((b) => b.target === target);
  if (!beat) throw new Error(`${score} has no beat named ${String(target)}`);
  return beat;
}
