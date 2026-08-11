/**
 * The character under Reduced motion, which is the one place its two tiers part company.
 *
 * `rest` and `attentive` are ambient: they carry warmth and nothing else, so Reduced removes them
 * and the character stands straight. `working`, `reacting` and `speaking` are informing, so they
 * are kept — but kept means REACHING THEIR END, not travelling to it, and a repeating beat played
 * at zero length would be a strobe. So `working` holds the pose its loop was carrying and the two
 * discrete beats have nothing to hold, which is the ceiling of a state whose whole content is
 * travel and the reason each of them has a card in the log standing behind it.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { useAgentSession } from '../../../agent/session';
import { CHARACTER_MOTION, NEUTRAL_POSE, type CharacterState } from '../../../ui/shell/assistant/character-state';
import { useMotionAllowed } from '../../../ui/shell/motion/use-motion';
import { useCharacterPose } from '../../../ui/shell/assistant/use-character-pose';

beforeEach(() => {
  act(() => { useAgentSession.setState({ log: [], running: false, thinking: false }); });
});
afterEach(cleanup);

function wrapper(reduced: boolean) {
  return ({ children }: { children: ReactNode }) => (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>
  );
}

function poseWith(reduced: boolean, open = false) {
  return renderHook(() => useCharacterPose(open), { wrapper: wrapper(reduced) });
}

/** A keyframe run: what a pose looks like when it is travelling rather than holding. */
const travels = (pose: object) => Object.values(pose).some((v) => Array.isArray(v));

describe('the character under reduced motion', () => {
  /**
   * The tier gate itself, asserted on the gate rather than on a pose.
   *
   * A pose cannot prove it: `rest` and `attentive` settle at neutral, so a build that kept them and
   * merely stopped their travel would show the same frame as one that dropped them, and the
   * assertion would be about nothing. Which tier each of the five is in is the decision.
   */
  it('drops the two decorative states under reduced motion and keeps the three informing ones', () => {
    const allowed = (reduced: boolean) => Object.fromEntries(
      (Object.keys(CHARACTER_MOTION) as CharacterState[]).map((state) => [
        state,
        renderHook(() => useMotionAllowed(CHARACTER_MOTION[state]), { wrapper: wrapper(reduced) })
          .result.current,
      ]),
    );
    expect(allowed(false))
      .toEqual({ rest: true, attentive: true, working: true, reacting: true, speaking: true });
    expect(allowed(true))
      .toEqual({ rest: false, attentive: false, working: true, reacting: true, speaking: true });
  });

  it('sways at rest, and stands still when motion is reduced', () => {
    expect(travels(poseWith(false).result.current.animate)).toBe(true);
    expect(poseWith(true).result.current.animate).toEqual(NEUTRAL_POSE);
  });

  it('leans when attending, and stands straight when motion is reduced', () => {
    expect(poseWith(false, true).result.current.animate.rotate).not.toBe(0);
    expect(poseWith(true, true).result.current.animate).toEqual(NEUTRAL_POSE);
  });

  it('still reaches the working pose when motion is reduced, without repeating it', () => {
    act(() => { useAgentSession.setState({ running: true }); });

    const full = poseWith(false).result.current;
    expect(full.state).toBe('working');
    expect(travels(full.animate), 'the pump repeats').toBe(true);
    expect(full.transition.repeat).toBe(Infinity);

    const reduced = poseWith(true).result.current;
    expect(reduced.state).toBe('working');
    expect(travels(reduced.animate), 'a loop at zero length is a strobe').toBe(false);
    expect(reduced.animate.scaleY, 'it holds the pose the pump was carrying').toBeLessThan(1);
    expect(reduced.transition).toEqual({ duration: 0 });
    expect(reduced.transition.repeat).toBeUndefined();
  });

  /** A card landing is still narrated by the card. The beat over it is travel and only travel. */
  it('drops the two discrete beats entirely when motion is reduced, and keeps the state', () => {
    // Both mounted BEFORE the card lands: arriving is a change, and a machine that opened onto a
    // log already holding the card has not seen one arrive.
    const full = poseWith(false);
    const reduced = poseWith(true);
    act(() => { useAgentSession.getState().pushEntry({ kind: 'note', text: 'a card' }); });

    expect(full.result.current.state).toBe('speaking');
    expect(travels(full.result.current.animate)).toBe(true);

    expect(reduced.result.current.state).toBe('speaking');
    expect(reduced.result.current.animate).toEqual(NEUTRAL_POSE);
  });

  it('falls back out of a beat on its own, with nothing else changing', async () => {
    const { result } = poseWith(false);
    expect(result.current.state).toBe('rest');
    await act(async () => {
      useAgentSession.getState().pushEntry({ kind: 'note', text: 'a card' });
    });
    expect(result.current.state).toBe('speaking');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(result.current.state, 'the beat ran out with no signal moving').toBe('rest');
  });

  it('turns toward the work when the pointer arrives, and back when it leaves', () => {
    const { result } = poseWith(false);
    expect(result.current.state).toBe('rest');
    act(() => { result.current.hover.onPointerEnter(); });
    expect(result.current.state).toBe('attentive');
    act(() => { result.current.hover.onPointerLeave(); });
    expect(result.current.state).toBe('rest');
  });
});
