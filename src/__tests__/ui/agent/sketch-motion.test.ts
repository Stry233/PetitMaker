/**
 * sketch-motion.test.ts — the idle dressings' beat sheet, pinned against the normative artifact's
 * own `sketchEngine`/`dreamEngine`.
 *
 * A DATA TEST, not an engine one: the file header claims every number here is the artifact's own,
 * so a pin on the numbers is what makes that claim checkable without a real WAAPI to run the loops
 * against (jsdom has none). Where a number here drifts from the artifact's source, one of these
 * fails.
 */
import { describe, it, expect } from 'vitest';
import { DREAM, SKETCH } from '../../../ui/agent/sketchbook/sketch-motion';

describe('the caption swap (sketchEngine.swapCap)', () => {
  it('fades out with no easing of its own, the WAAPI default', () => {
    // `capEl.animate([...], { duration: 140, fill: 'forwards' })` — no `easing` key, so the
    // default applies, which is `linear`. A curve written in here would be a beat this file never
    // played.
    expect(SKETCH.capOut).toEqual({ dur: 140, easing: 'linear' });
  });

  it('fades back in on the spring, risen from below', () => {
    expect(SKETCH.capIn.dur).toBe(260);
    expect(SKETCH.capIn.easing).toBe('cubic-bezier(.175,.885,.32,1.275)');
    expect(SKETCH.capRise).toBe(8);
  });
});

describe('the dream board row leaving (dreamEngine.rotateOnce)', () => {
  it('matches the ghost row\'s own fade-and-drift', () => {
    // `ghost.animate([...], { duration: 260, easing: PUNCHY, fill: 'forwards' })`.
    expect(DREAM.rowOut).toEqual({ dur: 260, easing: 'cubic-bezier(.2,0,0,1)' });
  });
});

describe('the sleeper\'s twitch (dreamEngine.twitch)', () => {
  it('is the artifact\'s own 220ms counter-swing, not a slower one-way lean', () => {
    // function twitch(){ hero.parts.body.animate([
    //   { transform: 'rotate(0deg)' }, { transform: 'rotate(2.8deg)', offset: .4 },
    //   { transform: 'rotate(-1.2deg)', offset: .7 }, { transform: 'rotate(0deg)' },
    // ], { duration: 220, easing: CURVE_OUT, composite: 'add' }); }
    expect(DREAM.twitchFrames.dur).toBe(220);
    expect(DREAM.twitchFrames.easing).toBe('cubic-bezier(.2,.8,.3,1)');
    expect(DREAM.twitchFrames.composite).toBe('add');
    expect(DREAM.twitchFrames.keyframes).toEqual([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(2.8deg)', offset: 0.4 },
      { transform: 'rotate(-1.2deg)', offset: 0.7 },
      { transform: 'rotate(0deg)' },
    ]);
  });
});

/**
 * THE SWAP IS THREE MOVES (`dreamEngine.rotateOnce`): the top order departs, the two under it GLIDE
 * UP into the places that opened, and the new one lands softly after them. Drop the glide and the two
 * survivors teleport one slot while a ghost fades over the top of them, which is the whole rotation
 * reading as a jump cut.
 */
describe('the dream board turning over (dreamEngine.rotateOnce)', () => {
  it('carries the survivors\' own glide', () => {
    // `rowEls[i].animate([{transform:`translateY(${dy}px)`},{transform:'none'}],
    //   { duration: 480, easing: 'cubic-bezier(.3,0,.1,1)' })`.
    expect(DREAM.rowGlide).toEqual({ dur: 480, easing: 'cubic-bezier(.3,0,.1,1)' });
  });

  it('lands the new row after the board has moved, not with it', () => {
    // `nr.animate([...], { duration: 420, delay: 160, easing: SPRING, fill: 'backwards' })`.
    expect(DREAM.rowIn.dur).toBe(420);
    expect(DREAM.rowIn.delay).toBe(160);
    expect(DREAM.rowIn.easing).toBe('cubic-bezier(.175,.885,.32,1.275)');
    // The arrival is slower than the departure it follows, which is what makes the two read as one
    // move rather than as a swap.
    expect(DREAM.rowIn.dur).toBeGreaterThan(DREAM.rowOut.dur);
  });
});

/**
 * SHE RESETTLES INSIDE THE HOLD, every second cycle (`dreamEngine.render`'s `p === 3 && b % 2 === 1`).
 * A declared beat that nothing plays is a beat the screen does not have: the sleep read as a still
 * image of a sleeper between twitches.
 */
describe('the sleeper resettling (dreamEngine.resettle)', () => {
  it('is a composited settle rather than a replacement of the sleeping pose', () => {
    expect(DREAM.resettleFrames.part).toBe('pose');
    expect(DREAM.resettleFrames.dur).toBe(950);
    expect(DREAM.resettleFrames.easing).toBe('ease-in-out');
    expect(DREAM.resettleFrames.composite).toBe('add');
    // It ends where it started, so nothing it plays over can be stranded by it.
    const frames = DREAM.resettleFrames.keyframes;
    expect(frames[0]).toEqual({ transform: 'none' });
    expect(frames[frames.length - 1]).toEqual({ transform: 'none' });
  });

  it('is spaced inside the cycle, after the dream has landed and before it goes', () => {
    expect(DREAM.resettle).toBeGreaterThan(DREAM.glyphIn);
    expect(DREAM.resettle).toBeLessThan(DREAM.glyphOut);
    expect(DREAM.resettle + DREAM.resettleFrames.dur).toBeLessThan(DREAM.cycle);
  });

  /** THE STIR COMPOSITES TOO. It plays on the same part the sleep's own fill holds, so a replacing
   *  animation would stand her up for its own 620ms and drop her back. */
  it('shares the composited rule with the pointer stir', () => {
    expect(DREAM.stirFrames.composite).toBe('add');
  });
});
