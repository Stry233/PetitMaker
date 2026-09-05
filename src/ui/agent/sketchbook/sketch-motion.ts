/*
 * sketch-motion.ts — the choreography of the two IDLE DRESSINGS: the sketchbook's rotation and the
 * dreaming office's beat sheet.
 *
 * A DECLARED EXEMPTION FROM THE REGISTRY, on the same footing as `character/poses.ts` and named in
 * `__tests__/ui/agent/motion-wiring.test.ts`. The registry answers "what moves, how long and why"
 * for the panel's INTERFACE motions — a card arriving, a paper repainting, a badge popping — each of
 * which is one declaration a component reads at one call site. What is here is a different kind of
 * thing: a LOOP with several beats in it, whose numbers are only meaningful against each other (the
 * wipe lands 800ms before the next idea, the ritual halfway through the hold, the dream's glyph
 * inside its own hold). Cutting that into registry entries would spread one piece of timing across
 * a dozen ids and still leave the reader unable to see the sheet.
 *
 * Both loops are AMBIENT in the registry's own sense: they say nothing the interface needs to say,
 * so reduced motion drops them outright and each dressing paints the complete still instead. Neither
 * runs while its card is off screen: the card's presence IS the engine's gate.
 */

/** Shared curves for the sketch and dream engines. */
const PUNCHY = 'cubic-bezier(.2,0,0,1)';
const SPRING = 'cubic-bezier(.175,.885,.32,1.275)';
const DRAW = 'cubic-bezier(.3,0,.2,1)';
/** Wake, slump and twitch curve used by the dream engine. */
const CURVE_OUT = 'cubic-bezier(.2,.8,.3,1)';

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
 * THE SKETCHBOOK'S CYCLE. One idea per `cycle`: it draws, it stands, it is wiped at `erase`, and the
 * next cycle brings the next idea. `ritual` is the point inside the hold where she may take one, and
 * `ritualEvery` how many cycles apart those are — sparse garnish, never a show.
 */
export const SKETCH = {
  cycle: 7600,
  erase: 6800,
  ritual: 3600,
  ritualEvery: 3,
  /** The pencil: the MASK's dashoffset runs, so the dashes appear tip-first and stay dashes.
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

/** A one-shot played on the character's own parts (`CharacterHandle.parts`). */
export interface Garnish {
  part: 'pose' | 'body';
  dur: number;
  easing: string;
  delay?: number;
  composite?: CompositeOperation;
  keyframes: Keyframe[];
}

/**
 * WHAT SHE DOES WHILE THE PENCIL MOVES, and between sketches.
 *
 * Every one ENDS AT IDENTITY with no forwards fill, so nothing here can strand the idle pose: the
 * pose machine's own transform is underneath, and a filled endpoint would replace it for good (the
 * dream engine's Chromium lesson, `character/Character.tsx`).
 */
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
 * THE DREAMING OFFICE'S BEAT SHEET. The board is a queue that turns over once a `cycle`; inside the
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
  /**
   * THE SWAP IS THREE MOVES, NOT ONE, and the board turns over as a board: the top order departs
   * (`rowOut`), the two under it GLIDE UP into the places it and its neighbour left (`rowGlide`), and
   * the new one lands softly at the foot after them (`rowIn`, which is why it carries a delay). Drop
   * the glide and the two survivors teleport up one slot while a ghost fades over the top of them,
   * which is the whole move reading as a jump cut.
   */
  rowOut: { dur: 260, easing: PUNCHY } as Beat,
  rowGlide: { dur: 480, easing: 'cubic-bezier(.3,0,.1,1)' } as Beat,
  rowIn: { dur: 420, delay: 160, easing: SPRING } as Beat,
  /**
   * THE BREATH THAT CARRIES THE ZZZ BACK: one bubble off the plume's lower-left, drifting up and out.
   *
   * It leaves at its OWN size and grows as it goes, which is what makes it read as a breath rather
   * than as a dot popping into existence: the opacity comes up over the first fifth and the rest of
   * the track is the drift, so the bubble is already there before it starts travelling. `fill: both`
   * holds it at the last frame's nothing, since the element's resting opacity is 0 anyway and a
   * `none` fill flashes the rest state for one frame at each end.
   */
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
  /** The twitch, played ON the sleeping pose (composited, so the sleep is not replaced). */
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
   * SHE RESETTLES INSIDE THE HOLD, every second cycle at `resettle`: a sleeper shifts, sinks a little
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
   *  OVER the sleep like the other two, so it composites as well. */
  stirFrames: {
    part: 'pose', dur: 620, easing: 'ease-in-out', composite: 'add',
    keyframes: [
      { transform: 'none' },
      { transform: 'translateY(-2px) rotate(1.2deg)', offset: 0.4 },
      { transform: 'none' },
    ],
  } as Garnish,
} as const;
