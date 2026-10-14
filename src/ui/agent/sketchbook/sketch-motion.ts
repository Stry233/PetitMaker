/*
 * The beat sheets of the two idle dressings, the sketchbook and the dreaming office. Like
 * `character/poses.ts`, an exemption from the motion registry named in `motion-wiring.test.ts`:
 * each is a loop whose beats are meaningful only against each other. Both are ambient, so reduced
 * motion drops them for a complete still, and neither runs while its card is off screen.
 */

import type { Garnish } from '../character/intent';
import { easing } from '../../design/styles';
import { CURVES } from '../character/poses';

/** Shared curves for the sketch and dream engines: the interface's punchy and stiff-spring easings,
 *  a drawing curve of their own, and the character's `out` curve for waking, slumping and twitching. */
const PUNCHY = easing.punchy;
const SPRING = easing.springStiff;
const DRAW = 'cubic-bezier(.3,0,.2,1)';
const CURVE_OUT = CURVES.out;

/** One WAAPI one-shot: how long, on what curve, and how far into the beat it starts. */
export interface Beat {
  dur: number;
  easing: string;
  delay?: number;
  /** Added per element where a family draws several: the dashes of one figure come in one after
   *  another, which is what makes a hand read into the drawing. */
  stagger?: number;
}

/**
 * The sketchbook's cycle. One idea per `cycle`: it draws, it stands, it is wiped at `erase`, and the
 * next cycle brings the next idea. `ritual` is the point inside the hold where she may take one, and
 * `ritualEvery` how many cycles apart those are — sparse garnish, never a show.
 */
export const SKETCH = {
  cycle: 7600,
  erase: 6800,
  ritual: 3600,
  ritualEvery: 3,
  /** The pencil: the mask's dashoffset runs, so the dashes appear tip-first and stay dashes.
   *  (Running the shape's own dashoffset replaces the pattern and reads as a solid line.) */
  draw: { dur: 1200, easing: DRAW, stagger: 250 } as Beat,
  /** The ghost of the built thing, arriving under the dashes once the line is most of the way in. */
  ghost: { dur: 600, easing: PUNCHY, delay: 900 } as Beat,
  /** A grove's pips popping in one by one. */
  pip: { dur: 300, easing: SPRING, delay: 200, stagger: 180 } as Beat,
  /** The wipe. */
  wipe: { dur: 420, easing: PUNCHY } as Beat,
  /** Caption swap: a linear exit followed by an entrance from below. */
  capOut: { dur: 140, easing: 'linear' } as Beat,
  capIn: { dur: 260, easing: SPRING } as Beat,
  /** How far the incoming caption rises from, in px. */
  capRise: 8,
  /** How much of the ghost shows through at rest: a band under the dashes, not a painted road. */
  ghostAlpha: { band: 0.55, fill: 0.45 },
} as const;


/** Her gestures while the pencil moves. Each ends at identity with no forwards fill, so the pose machine's transform underneath survives. */
export const GARNISH: Record<'scribble' | 'tea' | 'stretch', readonly Garnish[]> = {
  scribble: [
    {
      part: 'pose', dur: 1900, easing: 'ease-in-out',
      keyframes: [
        { transform: 'none' },
        { transform: 'rotate(4deg) translateY(2px)', offset: 0.25 },
        { transform: 'rotate(3deg) translateY(2px)', offset: 0.75 },
        { transform: 'none' },
      ],
    },
    {
      part: 'body', dur: 1500, easing: 'ease-in-out', delay: 200, composite: 'add',
      keyframes: [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(1.8deg)', offset: 0.2 },
        { transform: 'rotate(-1.4deg)', offset: 0.45 },
        { transform: 'rotate(1.8deg)', offset: 0.7 },
        { transform: 'rotate(0deg)' },
      ],
    },
  ],
  tea: [
    {
      part: 'pose', dur: 2400, easing: 'ease-in-out',
      keyframes: [
        { transform: 'none' },
        { transform: 'rotate(-3deg) translateY(1px) scaleY(1.01)', offset: 0.25 },
        { transform: 'rotate(-3deg) translateY(1px) scaleY(1.01)', offset: 0.8 },
        { transform: 'none' },
      ],
    },
  ],
  stretch: [
    {
      part: 'pose', dur: 1900, easing: 'ease-in-out',
      keyframes: [
        { transform: 'none' },
        { transform: 'translateY(3px) scale(1.09,.9)', offset: 0.18 },
        { transform: 'translateY(-6px) scale(.93,1.1) rotate(-2deg)', offset: 0.45 },
        { transform: 'translateY(-6px) scale(.93,1.1) rotate(2deg)', offset: 0.7 },
        { transform: 'translateY(1px) scale(1.04,.96)', offset: 0.88 },
        { transform: 'none' },
      ],
    },
  ],
};

/** How long the note badge stays up while she scribbles, and which badge-free rituals rotate. */
export const SCRIBBLE_BADGE_MS = 2100;
export const RITUALS = ['tea', 'stretch'] as const;

/**
 * The dreaming office's beat sheet. The board is a queue that turns over once a `cycle`; inside the
 * cycle she twitches, the dreamed order's glyph takes the zzz's place, and the zzz come back on one
 * breath. `resettleEvery` is how many cycles apart she resettles inside the hold.
 */
export const DREAM = {
  cycle: 3800,
  twitch: 650,
  glyphIn: 1200,
  resettle: 2050,
  resettleEvery: 2,
  glyphOut: 3050,
  /** The board's swap: the top order departs (`rowOut`), the two below glide up (`rowGlide`), and the new one lands after them (`rowIn`). */
  rowOut: { dur: 260, easing: PUNCHY } as Beat,
  rowGlide: { dur: 480, easing: 'cubic-bezier(.3,0,.1,1)' } as Beat,
  rowIn: { dur: 420, delay: 160, easing: SPRING } as Beat,
  /** The breath that carries the zzz back: one bubble growing as it drifts up. `fill: both` holds its last frame, as its resting opacity is 0. */
  puff: { dur: 900, easing: PUNCHY } as Beat,
  puffFrames: [
    { opacity: 0, transform: 'none', offset: 0 },
    { opacity: 1, offset: 0.2 },
    { opacity: 0, transform: 'translate(-9px,-20px) scale(1.6)', offset: 1 },
  ] as Keyframe[],
  /** The zzz giving way: they fade out as the dreamed order's glyph takes their place. */
  zzzFade: { dur: 220, easing: PUNCHY } as Beat,
  /** And the glyph arriving in their place: the plate fades in over its own beat while the disc
   *  springs up under it, which is why the two are separate lengths rather than one. */
  glyphFade: { dur: 240, easing: PUNCHY } as Beat,
  glyphRise: { dur: 300, easing: SPRING } as Beat,
  /** How small the arriving glyph's disc starts, as a fraction of itself. */
  glyphFrom: 0.55,
  /** The twitch, played on the sleeping pose (composited, so the sleep is not replaced). */
  twitchFrames: {
    part: 'body', dur: 220, easing: CURVE_OUT, composite: 'add',
    keyframes: [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(2.8deg)', offset: 0.4 },
      { transform: 'rotate(-1.2deg)', offset: 0.7 },
      { transform: 'rotate(0deg)' },
    ],
  } as Garnish,
  /**
   * She resettles inside the hold, every second cycle at `resettle`: a sleeper shifts, sinks a little
   * further and settles back. It is the one beat that keeps a long sleep from reading as a still
   * image, and it is composited for the same reason the twitch is — the sleeping pose's own fill is
   * what holds her slumped, and a replacing animation would take that away and stand her up.
   */
  resettleFrames: {
    part: 'pose', dur: 950, easing: 'ease-in-out', composite: 'add',
    keyframes: [
      { transform: 'none' },
      { transform: 'translateY(1.5px) rotate(-1deg) scaleY(.99)', offset: 0.3 },
      { transform: 'translateY(2.5px) rotate(-1.8deg) scale(1.03,.96)', offset: 0.6 },
      { transform: 'none' },
    ],
  } as Garnish,
  /** The stir a pointer passing over the board raises: she is asleep, and something moved. It plays
   *  over the sleep like the other two, so it composites as well. */
  stirFrames: {
    part: 'pose', dur: 620, easing: 'ease-in-out', composite: 'add',
    keyframes: [
      { transform: 'none' },
      { transform: 'translateY(-2px) rotate(1.2deg)', offset: 0.4 },
      { transform: 'none' },
    ],
  } as Garnish,
} as const;
