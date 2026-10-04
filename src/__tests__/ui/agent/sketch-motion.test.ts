/** Timing and keyframe contracts for the sketchbook and sleeping-screen animations. */
import { describe, it, expect } from 'vitest';
import { DREAM, SKETCH } from '../../../ui/agent/sketchbook/sketch-motion';
import { easing } from '../../../ui/design/styles';
import { CURVES } from '../../../ui/agent/character/poses';

describe('the caption swap', () => {
  it('fades out linearly, quicker than it fades back in', () => {
    expect(SKETCH.capOut.easing).toBe('linear');
    expect(SKETCH.capOut.dur).toBeLessThan(SKETCH.capIn.dur);
  });

  it('fades back in on the spring, risen from below', () => {
    expect(SKETCH.capIn.easing).toBe(easing.springStiff);
    expect(SKETCH.capRise).toBeGreaterThan(0);
  });
});

describe('the dream board row leaving', () => {
  it('fades on the punchy curve, gone before the survivors finish gliding up', () => {
    expect(DREAM.rowOut.easing).toBe(easing.punchy);
    expect(DREAM.rowOut.dur).toBeLessThan(DREAM.rowGlide.dur);
  });
});

describe('the sleeper\'s twitch', () => {
  it('is a composited counter-swing that starts and ends at rest', () => {
    const { keyframes, composite } = DREAM.twitchFrames;
    expect(DREAM.twitchFrames.easing).toBe(CURVES.out);
    expect(composite).toBe('add');
    expect(keyframes[0]).toEqual({ transform: 'rotate(0deg)' });
    expect(keyframes[keyframes.length - 1]).toEqual({ transform: 'rotate(0deg)' });
    const offsets = keyframes.map((k) => (k as { offset?: number }).offset).filter((o): o is number => o !== undefined);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    // A counter-swing: the interior rotations swing one way, then back past rest the other way.
    const angles = keyframes.slice(1, -1).map((k) => parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(String(k.transform))![1]!));
    expect(angles.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < angles.length; i++) expect(Math.sign(angles[i]!), `swing ${i}`).toBe(-Math.sign(angles[i - 1]!));
  });
});

/**
 * A board rotation moves the top row out, glides the remaining rows up, then lands the new row.
 */
describe('the dream board turning over', () => {
  it('is still gliding the survivors when the new row starts to land', () => {
    expect(DREAM.rowGlide.dur).toBeGreaterThan(DREAM.rowIn.delay!);
  });

  it('lands the new row after the board has moved, not with it', () => {
    expect(DREAM.rowIn.delay).toBeGreaterThan(0);
    expect(DREAM.rowIn.easing).toBe(easing.springStiff);
    // The arrival is slower than the departure it follows, which is what makes the two read as one
    // move rather than as a swap.
    expect(DREAM.rowIn.dur).toBeGreaterThan(DREAM.rowOut.dur);
  });
});

/**
 * The sleeping character resettles every second cycle while the board holds.
 */
describe('the sleeper resettling', () => {
  it('is a composited settle rather than a replacement of the sleeping pose', () => {
    expect(DREAM.resettleFrames.part).toBe('pose');
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
   *  animation would stand her up for its own run and drop her back. */
  it('shares the composited rule with the pointer stir', () => {
    expect(DREAM.stirFrames.composite).toBe('add');
  });
});
