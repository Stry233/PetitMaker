/**
 * The assistant character's state machine.
 *
 * The whole point of the machine being pure is that this is assertable directly: five states, two
 * of which run out on a clock, and an ordering between them that decides what a person sees when
 * two facts land in the same moment. A rendered frame could not show any of that.
 *
 * The poses are asserted as GEOMETRY rather than as numbers copied out of the source. What matters
 * is that the distance the registry declares is the distance the drawing's head actually moves, in
 * whichever way that state moves it, because that distance is the one the amplitude floor is
 * written in and the only thing tying the table to the screen.
 */
import { describe, it, expect } from 'vitest';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import {
  CHARACTER_MOTION, characterState, dwellOf, holdRemaining, initialMemory, observe, poseFor,
  type CharacterMemory, type CharacterSignals, type CharacterState,
} from '../../../ui/shell/assistant/character-state';

const IDLE: CharacterSignals = {
  panelOpen: false, pointerOver: false, running: false, thinking: false, cards: 0,
};

/** Play a list of readings through the machine, one per moment, and report what it showed at each. */
function play(readings: { at: number; signals: Partial<CharacterSignals> }[]): CharacterState[] {
  // Seeded from the FIRST reading, as the live hook is: a machine that started from nothing would
  // read a session it merely opened onto as a burst of cards arriving.
  let memory: CharacterMemory = initialMemory({ ...IDLE, ...readings[0]?.signals });
  return readings.map(({ at, signals }) => {
    const full = { ...IDLE, ...signals };
    memory = observe(memory, full, at);
    return characterState(memory, full, at);
  });
}

/** The height the shell renders the drawing at, near enough: the assertions are about ratios. */
const HEIGHT = 54;

describe('what the character is doing', () => {
  it('rests when nothing is happening', () => {
    expect(play([{ at: 0, signals: {} }])).toEqual(['rest']);
  });

  it('turns toward the work when its panel opens, and when the pointer arrives', () => {
    expect(play([{ at: 0, signals: { panelOpen: true } }])).toEqual(['attentive']);
    expect(play([{ at: 0, signals: { pointerOver: true } }])).toEqual(['attentive']);
  });

  it('works while a turn is in flight, including before the model has said anything', () => {
    expect(play([{ at: 0, signals: { running: true } }])).toEqual(['working']);
    expect(play([{ at: 0, signals: { thinking: true } }])).toEqual(['working']);
  });

  it('speaks when a card lands, and goes back to what it was doing', () => {
    const dwell = dwellOf('speaking');
    const states = play([
      { at: 0, signals: { running: true, cards: 0 } },
      { at: 10, signals: { running: true, cards: 1 } },
      { at: 10 + dwell, signals: { running: true, cards: 1 } },
    ]);
    expect(states).toEqual(['working', 'speaking', 'working']);
  });

  it('reacts once when the run stops, then settles', () => {
    const dwell = dwellOf('reacting');
    const states = play([
      { at: 0, signals: { running: true } },
      { at: 100, signals: { running: false, panelOpen: true } },
      { at: 100 + dwell, signals: { running: false, panelOpen: true } },
    ]);
    expect(states).toEqual(['working', 'reacting', 'attentive']);
  });

  /** The last card of a turn lands with the turn ending. Two beats on top of each other is what the
   *  inform tier forbids, and the ending is the larger of the two facts. */
  it('gives one beat when the last card lands with the run ending', () => {
    const states = play([
      { at: 0, signals: { running: true, cards: 3 } },
      { at: 50, signals: { running: false, cards: 4 } },
    ]);
    expect(states).toEqual(['working', 'reacting']);
  });

  /** A burst of cards is one continuous speaking, not one beat colliding with the next. */
  it('extends the speaking window on a second card rather than restarting it', () => {
    const dwell = dwellOf('speaking');
    const states = play([
      { at: 0, signals: { cards: 0 } },
      { at: 10, signals: { cards: 1 } },
      { at: 10 + dwell - 1, signals: { cards: 2 } },
      { at: 10 + dwell + 1, signals: { cards: 2 } },
      { at: 10 + dwell * 2, signals: { cards: 2 } },
    ]);
    expect(states).toEqual(['rest', 'speaking', 'speaking', 'speaking', 'rest']);
  });

  it('holds a transient state exactly as long as its own beat takes', () => {
    for (const state of ['reacting', 'speaking'] as const) {
      const motion = MOTIONS[CHARACTER_MOTION[state]];
      expect(dwellOf(state), state).toBe(('duration' in motion ? motion.duration : 0) * 1000);
    }
    // A standing state is a condition, not a beat: nothing runs out.
    for (const state of ['rest', 'attentive', 'working'] as const) expect(dwellOf(state), state).toBe(0);
  });

  it('reports when it will next need waking, since a beat ends with no signal changing', () => {
    let memory = initialMemory(IDLE);
    expect(holdRemaining(memory, 0)).toBeNull();
    memory = observe(memory, { ...IDLE, cards: 1 }, 1000);
    expect(holdRemaining(memory, 1000)).toBe(dwellOf('speaking'));
    expect(holdRemaining(memory, 1000 + dwellOf('speaking'))).toBeNull();
  });
});

describe('the pose each state takes', () => {
  /** The keyframe furthest from where the property rests, which is where the motion is measured. */
  const extreme = (value: number | number[], resting: number) => (Array.isArray(value)
    ? value.reduce((a, b) => (Math.abs(b - resting) > Math.abs(a - resting) ? b : a))
    : value);

  /** Where the top of the drawing ends up, relative to standing straight. */
  function headOffset(pose: { rotate: number | number[]; scaleY: number | number[] }) {
    return {
      across: Math.sin((extreme(pose.rotate, 0) * Math.PI) / 180) * HEIGHT,
      up: (extreme(pose.scaleY, 1) - 1) * HEIGHT,
    };
  }

  it('moves the head exactly as far as the registry says, in every state', () => {
    for (const state of ['rest', 'attentive', 'working', 'reacting', 'speaking'] as const) {
      const { travelling } = poseFor(state, HEIGHT);
      const { across, up } = headOffset(travelling);
      const declared = MOTIONS[CHARACTER_MOTION[state]].amplitude;
      expect(Math.hypot(across, up), `${state} does not travel its declared amplitude`)
        .toBeCloseTo(declared, 6);
    }
  });

  /** Squash and stretch, not a picture being resized: the drawing keeps its area either way. */
  it('keeps the area of the drawing while it squashes and stretches', () => {
    for (const state of ['working', 'reacting'] as const) {
      const { travelling } = poseFor(state, HEIGHT);
      const x = travelling.scaleX as number[];
      const y = travelling.scaleY as number[];
      for (let i = 0; i < x.length; i++) expect((x[i] ?? 0) * (y[i] ?? 0), state).toBeCloseTo(1, 6);
    }
  });

  it('dips while it works and springs up when it is done', () => {
    expect(headOffset(poseFor('working', HEIGHT).travelling).up).toBeLessThan(0);
    expect(headOffset(poseFor('reacting', HEIGHT).travelling).up).toBeGreaterThan(0);
  });

  it('leans toward the panel when it is attending and when it speaks', () => {
    expect(headOffset(poseFor('attentive', HEIGHT).travelling).across).toBeGreaterThan(0);
    expect(headOffset(poseFor('speaking', HEIGHT).travelling).across).toBeGreaterThan(0);
  });

  /** Every state writes all three properties, so none of them can be left where the state before it
   *  put it: a character that stayed squashed after a run would be a bug nothing else would catch. */
  it('writes every transform property in every state', () => {
    for (const state of ['rest', 'attentive', 'working', 'reacting', 'speaking'] as const) {
      for (const target of Object.values(poseFor(state, HEIGHT))) {
        expect(Object.keys(target).sort(), state).toEqual(['rotate', 'scaleX', 'scaleY']);
      }
    }
  });

  /**
   * `working` is the one informing state with somewhere to be when it may not travel: it holds at
   * the bottom of its pump, which is the fact the loop was carrying. The other two are pure travel
   * and settle where they started, which is why each also needs a card in the log behind it.
   */
  it('leaves working somewhere to settle and the two beats nowhere', () => {
    const { settled: working } = poseFor('working', HEIGHT);
    expect(headOffset(working).up).toBeLessThan(0);
    for (const state of ['reacting', 'speaking'] as const) {
      expect(poseFor(state, HEIGHT).settled, state).toEqual({ rotate: 0, scaleX: 1, scaleY: 1 });
    }
  });
});
