/*
 * The beat sheets of the two idle dressings, the sketchbook and the dreaming office: scripted
 * timelines (`design/motion/timeline.ts`) whose beats are meaningful only against each other, on the
 * set's curves, and on a registry motion's timing where a beat does that motion's job. Both are
 * ambient, so reduced motion drops them for a complete still, and neither runs while its card is off
 * screen.
 */

import type { Garnish } from '../character/intent';
import { CSS_CURVES } from '../../design/motion/curves';
import { beatFor, timeline, type TimelineBeat } from '../../design/motion/timeline';

/** The curves the sketch and dream engines move on, all from the set: the pencil swings from rest to
 *  rest, a pip or a glyph lands with a snap, and a twitch is thrown and caught. */
const PUNCHY = CSS_CURVES.punchy;
const SNAP = CSS_CURVES.snap;
const DRAW = CSS_CURVES.swing;
const TOSS = CSS_CURVES.toss;

/** One WAAPI one-shot: how long, on what curve, and how far into the beat it starts. A family's
 *  `stagger` brings the dashes of one figure in one after another, which is what makes a hand read
 *  into the drawing. */
export type Beat = TimelineBeat;

/**
 * The sketchbook's cycle. One idea per `cycle`: it draws, it stands, it is wiped at `erase`, and the
 * next cycle brings the next idea. `ritual` is the point inside the hold where she may take one, and
 * `ritualEvery` how many cycles apart those are — sparse garnish, never a show.
 */
export const SKETCH = timeline({
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
  pip: { dur: 300, easing: SNAP, delay: 200, stagger: 180 } as Beat,
  /** The wipe. */
  wipe: { dur: 420, easing: PUNCHY } as Beat,
  /** Caption swap: an exit followed by an entrance from below. */
  capOut: { dur: 140, easing: PUNCHY } as Beat,
  capIn: { dur: 260, easing: SNAP } as Beat,
  /** How far the incoming caption rises from, in px. */
  capRise: 8,
  /** How much of the ghost shows through at rest: a band under the dashes, not a painted road. */
  ghostAlpha: { band: 0.55, fill: 0.45 },
} as const);


/** Her gestures while the pencil moves. Each ends at identity with no forwards fill, so the pose machine's transform underneath survives. */
export const GARNISH: Record<'scribble' | 'tea' | 'stretch', readonly Garnish[]> = timeline({
  scribble: [
    {
      part: 'pose', dur: 1900, easing: CSS_CURVES.swing,
      keyframes: [
        { transform: 'none' },
        { transform: 'rotate(4deg) translateY(2px)', offset: 0.25 },
        { transform: 'rotate(3deg) translateY(2px)', offset: 0.75 },
        { transform: 'none' },
      ],
    },
    {
      part: 'body', dur: 1500, easing: CSS_CURVES.swing, delay: 200, composite: 'add',
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
      part: 'pose', dur: 2400, easing: CSS_CURVES.swing,
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
      part: 'pose', dur: 1900, easing: CSS_CURVES.swing,
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
});

/** How long the note badge stays up while she scribbles, and which badge-free rituals rotate. */
export const SCRIBBLE_BADGE_MS = 2100;
export const RITUALS = ['tea', 'stretch'] as const;

/**
 * The dreaming office's beat sheet. The board is a queue that turns over once a `cycle`; inside the
 * cycle she twitches, the dreamed order's glyph takes the zzz's place, and the zzz come back on one
 * breath. `resettleEvery` is how many cycles apart she resettles inside the hold.
 */
export const DREAM = timeline({
  cycle: 3800,
  twitch: 650,
  glyphIn: 1200,
  resettle: 2050,
  resettleEvery: 2,
  glyphOut: 3050,
  /** The board's swap: the top order departs (`rowOut`), the two below glide up (`rowGlide`), and the new one lands after them (`rowIn`). */
  rowOut: beatFor('surface.leave'),
  rowGlide: beatFor('selection.card.move'),
  rowIn: { ...beatFor('panel.op.enter'), delay: 160 } as Beat,
  /** The breath that carries the zzz back: one bubble growing as it drifts up. `fill: both` holds its last frame, as its resting opacity is 0. */
  puff: { dur: 900, easing: PUNCHY } as Beat,
  puffFrames: [
    { opacity: 0, transform: 'none', offset: 0 },
    { opacity: 1, offset: 0.2 },
    { opacity: 0, transform: 'translate(-9px,-20px) scale(1.6)', offset: 1 },
  ] as Keyframe[],
  /** The zzz giving way: they fade out as the dreamed order's glyph takes their place. */
  zzzFade: beatFor('panel.status.update'),
  /** And the glyph arriving in their place: the plate fades in over its own beat while the disc
   *  springs up under it, which is why the two are separate lengths rather than one. */
  glyphFade: beatFor('panel.status.update'),
  glyphRise: { dur: 300, easing: SNAP } as Beat,
  /** How small the arriving glyph's disc starts, as a fraction of itself. */
  glyphFrom: 0.55,
  /** The twitch, played on the sleeping pose (composited, so the sleep is not replaced). */
  twitchFrames: {
    part: 'body', dur: 220, easing: TOSS, composite: 'add',
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
    part: 'pose', dur: 950, easing: CSS_CURVES.swing, composite: 'add',
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
    part: 'pose', dur: 620, easing: CSS_CURVES.swing, composite: 'add',
    keyframes: [
      { transform: 'none' },
      { transform: 'translateY(-2px) rotate(1.2deg)', offset: 0.4 },
      { transform: 'none' },
    ],
  } as Garnish,
} as const);
