// @vitest-environment jsdom
/**
 * jsdom has no Web Animations API, so this polyfills the slice `Character.tsx` calls: a fake
 * `Animation` recording keyframes and options, tracking `playState`, and for a forwards fill
 * finishing on its own `duration` (through `setTimeout`, so fake timers drive it) and then holding
 * its last keyframe over the inline style, as a real one does until cancelled. `visualTransform(el)`
 * reads that override, so the badge-cancel test can tell a stale finished animation showing
 * `scale(0)` from an inline `scale(0)`, the case `setBadge`'s cancel-before-pop exists for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { Character } from '../../../../ui/agent/character/Character';
import { cueCharacter, setIntentDream } from '../../../../ui/agent/character/intent';
import { Badge } from '../../../../ui/agent/character/badges';
import { MICRO, POSE_DWELL, POSES, PRESS_SQUASH, WAKE_BEAT, poseForPhase, type PoseName } from '../../../../ui/agent/character/poses';
import type { SessionPhase } from '../../../../agent/core/project-view';
import { amplitude, framerMotion } from '../../../../ui/design/motion';
import { pressable } from '../../../../ui/design/styles';

type FakeKeyframe = { transform?: string; opacity?: number; offset?: number };
type FakeOptions = { duration?: number; delay?: number; easing?: string; iterations?: number; fill?: FillMode; composite?: string };

class FakeAnimation {
  playState: 'running' | 'finished' | 'idle' = 'running';
  replaceState: 'active' | 'persisted' = 'active';
  onfinish: (() => void) | null = null;
  readonly target: Element;
  readonly lastKeyframe: FakeKeyframe;
  readonly fill: FillMode;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(target: Element, keyframes: FakeKeyframe[], options: FakeOptions) {
    this.target = target;
    this.lastKeyframe = keyframes[keyframes.length - 1] ?? {};
    this.fill = options.fill ?? 'none';
    registryFor(target).push(this);
    const total = (options.delay ?? 0) + (options.duration ?? 0);
    // Infinite-iteration loops never finish on their own (matches the real API: only a bounded
    // animation's playState settles to 'finished' by itself).
    if ((options.iterations ?? 1) !== Infinity) {
      this.timer = setTimeout(() => this.finish(), total);
    }
  }
  cancel() {
    if (this.playState === 'idle') return;
    if (this.timer) clearTimeout(this.timer);
    this.playState = 'idle';
    const list = registryFor(this.target);
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
  }
  persist() { this.replaceState = 'persisted'; }
  finish() {
    if (this.playState === 'idle') return;
    this.playState = 'finished';
    this.onfinish?.();
  }
}

let anims = new WeakMap<Element, FakeAnimation[]>();
/** Every `.animate()` call made anywhere in the character since the last mount: the count is the
 *  churn a convulsion is made of, and the recorded options are what a beat is pinned by. */
let animateCalls: {
  part: string | undefined;
  iterations: number | undefined;
  duration: number | undefined;
  easing: string | undefined;
  composite: string | undefined;
  keyframes: FakeKeyframe[];
}[] = [];
function registryFor(el: Element): FakeAnimation[] {
  let list = anims.get(el);
  if (!list) { list = []; anims.set(el, list); }
  return list;
}

/** The element's effective transform: a still-finished `forwards`/`both` animation overrides the
 *  element's own inline style until canceled, exactly like a real composited Web Animation. */
function visualTransform(el: HTMLElement): string {
  const list = registryFor(el).filter((a) => a.playState === 'finished' && (a.fill === 'forwards' || a.fill === 'both'));
  const top = list[list.length - 1];
  return top?.lastKeyframe.transform ?? el.style.transform;
}

beforeEach(() => {
  anims = new WeakMap();
  animateCalls = [];
  Element.prototype.animate = function (this: Element, keyframes: unknown, options: unknown) {
    const opts = (options ?? {}) as FakeOptions;
    animateCalls.push({
      part: (this as HTMLElement).dataset?.part,
      iterations: opts.iterations,
      duration: opts.duration,
      easing: opts.easing,
      composite: opts.composite,
      keyframes: (keyframes ?? []) as FakeKeyframe[],
    });
    return new FakeAnimation(this, (keyframes ?? []) as FakeKeyframe[], opts) as unknown as Animation;
  } as typeof Element.prototype.animate;
  Element.prototype.getAnimations = function (this: Element) {
    return registryFor(this).filter((a) => a.playState !== 'idle') as unknown as Animation[];
  } as typeof Element.prototype.getAnimations;
});

function part(container: HTMLElement, name: string): HTMLElement {
  return container.querySelector(`[data-part="${name}"]`) as HTMLElement;
}

describe('poseForPhase', () => {
  it('maps the state-inventory table when connected', () => {
    const cases: [SessionPhase, PoseName][] = [
      ['idle', 'idle'],
      ['thinking', 'thinking'],
      ['streaming', 'thinking'],
      ['executing', 'working'],
      ['gated', 'asking'],
      ['retrying', 'trouble'],
      ['incident', 'trouble'],
      ['paused', 'paused'],
      ['pausing', 'paused'],
      ['aborted', 'idle'],
    ];
    for (const [phase, pose] of cases) {
      expect(poseForPhase(phase, { connected: true }), phase).toBe(pose);
    }
  });

  it('shows sleeping whenever disconnected, regardless of phase', () => {
    const phases: SessionPhase[] = ['idle', 'thinking', 'executing', 'gated', 'paused', 'incident'];
    for (const phase of phases) {
      expect(poseForPhase(phase, { connected: false }), phase).toBe('sleeping');
    }
  });

  it('never returns the two one-shots — they are triggered explicitly, not derived from phase', () => {
    const phases: SessionPhase[] = ['idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing', 'paused', 'aborted', 'incident'];
    for (const phase of phases) {
      const pose = poseForPhase(phase, { connected: true });
      expect(pose).not.toBe('celebrating');
      expect(pose).not.toBe('noted');
    }
  });

  /** The three poses a surface owns rather than a phase: the two the setup screen passes in and the
   *  one the region marking does. A phase mapping that started answering one of them would be
   *  claiming a moment it cannot see. */
  it('never returns a pose a surface owns', () => {
    const phases: SessionPhase[] = ['idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing', 'paused', 'aborted', 'incident'];
    const surfaceOwned: PoseName[] = ['keylean', 'pleased', 'watching'];
    for (const phase of phases) {
      for (const owned of surfaceOwned) {
        expect(poseForPhase(phase, { connected: true }), `${phase}/${owned}`).not.toBe(owned);
      }
    }
  });
});

describe('the pose table', () => {
  it('gives each pose a resting frame the reduced-motion path can hold', () => {
    for (const [name, spec] of Object.entries(POSES)) {
      expect(typeof spec.static, name).toBe('string');
      // A pose with no tracks at all would be a name with no choreography behind it.
      const tracks = [...(spec.enter ?? []), ...(spec.seq ?? []), ...(spec.loops ?? [])];
      expect(tracks.length, name).toBeGreaterThan(0);
    }
  });

  /** Surface-controlled reading poses carry no verdict; only confirmation carries the spark. */
  it('gives the setup pair the badges its own states call for', () => {
    expect(POSES.keylean.badge).toBeNull();
    expect(POSES.watching.badge).toBeNull();
    expect(POSES.pleased.badge).toBe('spark');
  });

  /** Confirmation holds until the setup screen advances it. */
  it('holds the confirmed face instead of settling out of it', () => {
    expect(POSES.pleased.oneShot).toBeUndefined();
    expect(POSES.celebrating.oneShot).toBe(true);
  });
});

describe('Character rendering', () => {
  afterEach(() => vi.useRealTimers());

  it('renders the base art once', () => {
    const { container } = render(<Character pose="idle" size={64} />);
    const imgs = container.querySelectorAll('img[data-badge]');
    expect(imgs.length).toBe(0);
    expect(container.querySelectorAll('img').length).toBe(1);
  });

  it('shows the PNG ask badge while asking', () => {
    const { container } = render(<Character pose="asking" size={64} />);
    expect(container.querySelector('img[data-badge="ask"]')).not.toBeNull();
  });

  /** The working badge is an inline drawing rather than a raster image. */
  it('shows the drawn refresh badge (SVG, not PNG) while working', () => {
    const { container } = render(<Character pose="working" size={64} />);
    expect(container.querySelector('[data-badge="refresh"]')?.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('img[data-badge="refresh"]')).toBeNull();
  });

  it('shows the drawn exclaim badge (SVG, not PNG) while in trouble', () => {
    const { container } = render(<Character pose="trouble" size={64} />);
    expect(container.querySelector('[data-badge="exclaim"]')?.tagName.toLowerCase()).toBe('svg');
  });

  it('shows no badge while idle', () => {
    const { container } = render(<Character pose="idle" size={64} />);
    expect(container.querySelector('[data-badge]')).toBeNull();
  });
});

describe('reduced motion', () => {
  function mountReduced(pose: PoseName) {
    return render(
      <MotionConfig reducedMotion="always">
        <Character pose={pose} size={64} />
      </MotionConfig>,
    );
  }

  it('never calls .animate() anywhere in the character (getAnimations stays empty)', () => {
    const { container } = mountReduced('thinking');
    for (const name of ['flip', 'pose', 'body', 'badge', 'badge-spin'] as const) {
      const el = part(container, name);
      expect(el.getAnimations(), name).toHaveLength(0);
    }
  });

  it('lands on the pose\'s static transform with no animation', () => {
    const { container } = mountReduced('asking');
    expect(part(container, 'pose').style.transform).toBe(POSES.asking.static);
  });

  it('still shows the static badge for a one-shot at rest', () => {
    const { container } = mountReduced('celebrating');
    expect(container.querySelector('[data-badge="spark"]')).not.toBeNull();
  });
});

describe('the badge-cancel gotcha (fill:forwards swap-out re-asserting scale(0))', () => {
  it('leaves the badge at scale(1), not stuck at scale(0), after two rapid pose swaps', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Character pose="thinking" size={64} />);
    const badgeEl = part(container, 'badge');

    // First badge (thinking → idea) lands synchronously: nothing to swap out yet.
    expect(container.querySelector('img[data-badge="idea"]')).not.toBeNull();
    expect(visualTransform(badgeEl)).toBe('scale(1)');

    // Rapid second pose change before the first badge's own pop-in animation would finish:
    // this is what arms the swap-out (fill:'forwards', 110ms) whose hold must be canceled. A pose
    // asked for is worn one dwell later (`POSE_DWELL`), which is when the swap is armed.
    act(() => { rerender(<Character pose="working" size={64} />); });
    act(() => { vi.advanceTimersByTime(POSE_DWELL); });

    // Mid-flight: the swap-out has been armed but not yet applied its forwards hold.
    act(() => { vi.advanceTimersByTime(60); });
    expect(container.querySelector('img[data-badge="idea"]'), 'still showing the outgoing badge mid-swap').not.toBeNull();

    // Let the swap-out finish (110ms total) and the scheduled pop-in fire (170ms total: the
    // recorded gotcha's window, `BADGE_SWAP_OUT_MS + BADGE_SWAP_GAP_MS`).
    act(() => { vi.advanceTimersByTime(200); });

    expect(container.querySelector('[data-badge="refresh"]'), 'the new badge is showing').not.toBeNull();
    expect(visualTransform(badgeEl)).not.toBe('scale(0)');
    expect(visualTransform(badgeEl)).toBe('scale(1)');
  });
});

/**
 * A pose is a gesture, and a gesture is never cut short.
 *
 * The pose she wears is derived from the session's phase, and that phase is derived from the live
 * streaming parts: inside one model turn it moves from `streaming` to `executing` and back as text
 * and tool calls arrive, several times a second. Adopting each of those as it landed cancelled every
 * animation on her and restarted the next entrance from nothing — measured in the live app at a 140ms
 * input, 142 restarts in 20 seconds, which is what "she convulses" is made of, and what a breath
 * restarted seven times a second reads as.
 */
describe('the pose engine under a phase that flaps', () => {
  // The clock is faked too, not just the timers: the dwell is measured against `performance.now()`,
  // so a run whose timers jump 20 seconds while the clock stands still would test a state the app
  // cannot be in (every wait re-derived as the full dwell, so nothing ever lands).
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('wears at most one pose per dwell however fast the phase moves', () => {
    const span = 20_000;
    const every = 140;
    const { rerender } = render(<Character pose="thinking" size={64} />);
    act(() => { vi.advanceTimersByTime(POSE_DWELL); });
    animateCalls = [];
    let i = 0;
    for (let t = 0; t < span; t += every) {
      i += 1;
      const pose = i % 2 ? 'working' as const : 'thinking' as const;
      // The commit on its own, then the clock: the effect has to see the change at the moment it
      // arrives, or the dwell is measured from a clock that has already moved on.
      act(() => { rerender(<Character pose={pose} size={64} />); });
      act(() => { vi.advanceTimersByTime(every); });
    }
    // Both poses breathe on the same part, so a loop starting on `body` is exactly one landing
    // (`working` also loops its `pose` part, which would count a landing twice). What is bounded is
    // how many times that can happen: one per dwell, plus the one in flight.
    const landings = animateCalls.filter((a) => a.iterations === Infinity && a.part === 'body').length;
    expect(landings).toBeLessThanOrEqual(Math.ceil(span / POSE_DWELL) + 1);
    // And well under 142, the measured reading this bound exists to rule out over this span.
    expect(landings).toBeLessThan(50);
    expect(landings).toBeGreaterThan(0);
  });

  it('leaves the gesture she is wearing alone while the phase moves under her', () => {
    const { container, rerender } = render(<Character pose="thinking" size={64} />);
    act(() => { vi.advanceTimersByTime(POSE_DWELL); });
    animateCalls = [];
    const running = () => part(container, 'body').getAnimations().length;
    const before = running();
    expect(before).toBeGreaterThan(0);
    // Four phase changes inside one dwell: the pose she is wearing keeps its own animations, and
    // nothing is torn down and rebuilt per commit.
    act(() => {
      for (const pose of ['working', 'thinking', 'working', 'thinking'] as const) {
        rerender(<Character pose={pose} size={64} />);
        vi.advanceTimersByTime(40);
      }
    });
    expect(running()).toBe(before);
    expect(animateCalls.filter((a) => a.iterations === Infinity)).toHaveLength(0);
  });

  /** The ambient gestures compose with the breath rather than replacing it: both play on the same
   *  part and the same property, so a flick that replaced the transform dropped the breath to its
   *  rest value for its own 120ms and snapped it back at the end. */
  it('plays the ear-flick additively over the breath', () => {
    expect(MICRO.earflick.part).toBe('body');
    expect(POSES.idle.loops?.[0]?.part).toBe('body');
    expect(MICRO.earflick.composite).toBe('add');
  });
});

/** The character control uses the same hover and press feedback as the surrounding mode controls. */
describe('the character wears the house hover', () => {
  it('grows by the shared amount, on the shared spring', () => {
    expect(amplitude('panel.character.hover')).toBeCloseTo(pressable.whileHover.scale - 1, 12);
    expect(framerMotion('panel.character.hover')).toEqual(pressable.transition);
  });

  /** No independent lift composes with the shared scale transform. */
  it('writes no lift of its own on the drawing', () => {
    const { getByTestId } = render(
      <Character pose="idle" size={64} press={{ onPress: () => {}, open: false }} />,
    );
    expect(getByTestId('pw-character').style.translate).toBe('');
  });
});

/** The sleeping pose combines a held droop with a two-axis breathing loop. */
describe('the sleeping pose', () => {
  afterEach(() => vi.useRealTimers());

  /** A breath begun under a droop still travelling composes the two moves into one shudder. */
  it('starts the breath exactly where the droop lands', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const droop = POSES.sleeping.enter?.[0]?.dur ?? 0;
    const { container } = render(<Character pose="sleeping" size={64} />);
    expect(droop).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(droop - 1); });
    expect(part(container, 'body').getAnimations()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(part(container, 'body').getAnimations()).toHaveLength(1);
  });

  /** Browsers may remove a replaceable, forwards-filled animation when a newer animation targets
   * the same property. Persisting the droop keeps additive sleep details from displacing it. */
  it('persists the droop so an additive garnish cannot sweep it away', () => {
    const { container } = render(<Character pose="sleeping" size={64} />);
    const holds = part(container, 'pose').getAnimations() as unknown as FakeAnimation[];
    expect(holds).toHaveLength(1);
    expect(holds[0]?.fill).toBe('forwards');
    expect(holds[0]?.replaceState).toBe('persisted');
  });

  it('holds the lids down and wears the plume for the whole pose', () => {
    expect(POSES.sleeping.lids).toBe(true);
    expect(POSES.sleeping.badge).toBe('zzz');
    // A sleeper does not blink: the lids are already down, so a timer here would animate nothing.
    expect(POSES.sleeping.timers).toBeUndefined();
  });

  it('rests on the droop it entered with, so the reduced still is the same slump', () => {
    const droop = POSES.sleeping.enter?.[0]?.keyframes ?? [];
    const { container } = render(
      <MotionConfig reducedMotion="always"><Character pose="sleeping" size={64} /></MotionConfig>,
    );
    expect(part(container, 'pose').style.transform).toBe(droop[droop.length - 1]?.transform);
  });
});

/**
 * The engine survives StrictMode's simulated remount. React's dev-only mount, cleanup, mount cycle
 * runs the unmount cleanup — which cancels every animation and timer — and then the effects again
 * on the same instance, whose `worn` ref still claims the pose is standing. Without resetting it
 * the re-run rebuilt nothing, and in the dev app she booted into a still: pose applied, lids down,
 * not one animation on any part (no slump, no breath) until the first pose change.
 */
describe('the engine under StrictMode\'s double mount', () => {
  afterEach(() => vi.useRealTimers());

  it('stands the enter hold and the breath after the simulated remount', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { container } = render(
      <StrictMode><Character pose="sleeping" size={64} /></StrictMode>,
    );
    expect(part(container, 'pose').getAnimations()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(900); });
    expect(part(container, 'body').getAnimations()).toHaveLength(1);
  });
});

/** The wake beat starts at the sleeping transform, overshoots neutral, and yields to any newer pose
 * animation on the same part. */
describe('the Connect-press wake beat', () => {
  afterEach(() => vi.useRealTimers());

  it('starts from the sleeping rest, so the rise has no jump in it', () => {
    expect(WAKE_BEAT.keyframes[0]?.transform).toBe(POSES.sleeping.static);
  });

  it('plays on the pose part from sleep, survives the landing pose, and the lids open with it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { container, rerender } = render(<Character pose="sleeping" size={64} />);
    act(() => { vi.advanceTimersByTime(POSE_DWELL); });
    animateCalls = [];
    act(() => { cueCharacter({ kind: 'wake' }); });
    const beats = animateCalls.filter((a) => a.part === 'pose');
    expect(beats).toHaveLength(1);
    expect(beats[0]?.duration).toBe(WAKE_BEAT.dur);
    expect(beats[0]?.easing).toBe(WAKE_BEAT.easing);
    expect(beats[0]?.keyframes).toEqual(WAKE_BEAT.keyframes);

    // The key screen lands (`idle`): its clear cancels the sleep pose's own forwards-filled droop,
    // and the beat plays on underneath the new pose.
    act(() => { rerender(<Character pose="idle" size={64} />); });
    const poseEl = part(container, 'pose');
    expect(poseEl.getAnimations().map((a) => a.playState)).toEqual(['running']);
    // And the lids open on the same press, with the landing pose.
    expect(part(container, 'lid-l').style.transform).toBe('scaleY(0)');
    expect(part(container, 'lid-r').style.transform).toBe('scaleY(0)');
  });

  it('plays nothing when she is already awake', () => {
    render(<Character pose="idle" size={64} />);
    animateCalls = [];
    act(() => { cueCharacter({ kind: 'wake' }); });
    expect(animateCalls.filter((a) => a.part === 'pose')).toHaveLength(0);
  });

  it('is skipped outright under reduced motion', () => {
    render(
      <MotionConfig reducedMotion="always"><Character pose="sleeping" size={64} /></MotionConfig>,
    );
    animateCalls = [];
    act(() => { cueCharacter({ kind: 'wake' }); });
    expect(animateCalls).toHaveLength(0);
  });
});

/** Press acknowledgement is additive so it can run over the body's breathing animation. */
describe('the press acknowledgement', () => {
  it('plays on her body when she is pressed, and the press still lands', () => {
    const onPress = vi.fn();
    const { getByTestId } = render(
      <Character pose="idle" size={64} press={{ onPress, open: false }} />,
    );
    animateCalls = [];
    fireEvent.click(getByTestId('pw-character'));
    expect(onPress).toHaveBeenCalledTimes(1);
    const squashes = animateCalls.filter((a) => a.part === 'body');
    expect(squashes).toHaveLength(1);
    expect(squashes[0]?.duration).toBe(PRESS_SQUASH.dur);
    expect(squashes[0]?.easing).toBe(PRESS_SQUASH.easing);
    expect(squashes[0]?.composite).toBe('add');
    expect(squashes[0]?.keyframes).toEqual(PRESS_SQUASH.keyframes);
  });

  /** The surface that owns a press she cannot hear (the keyless rest's Connect) cues the same squash. */
  it('acknowledges a cue too', () => {
    render(<Character pose="idle" size={64} />);
    animateCalls = [];
    act(() => { cueCharacter({ kind: 'acknowledge' }); });
    expect(animateCalls.filter((a) => a.part === 'body' && a.composite === 'add')).toHaveLength(1);
  });

  it('is skipped under reduced motion, while the press still lands', () => {
    const onPress = vi.fn();
    const { getByTestId } = render(
      <MotionConfig reducedMotion="always">
        <Character pose="idle" size={64} press={{ onPress, open: false }} />
      </MotionConfig>,
    );
    animateCalls = [];
    fireEvent.click(getByTestId('pw-character'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(animateCalls).toHaveLength(0);
  });
});

/**
 * The plume's three marks play. The pose table's own line for `sleeping` says "z marks in sequence",
 * and while the badge was a still drawing that sentence described nothing on screen. The beat is
 * `pw-zzzfade` in `design/animations.css`, which carries the reduced-motion gate with it; the marks
 * carry its class and the two delays that make them a sequence rather than a blink.
 */
describe('the sleeper\'s zzz', () => {
  it('gives each mark the shared fade and staggers the last two', () => {
    const { container } = render(<Badge id="zzz" />);
    const marks = [...container.querySelectorAll('.pw-zzz-mark')];
    expect(marks).toHaveLength(3);
    expect(marks[1]?.classList.contains('pw-zzz-mark-2')).toBe(true);
    expect(marks[2]?.classList.contains('pw-zzz-mark-3')).toBe(true);
    // The first carries no delay class: it is the one the other two are late against.
    expect(marks[0]?.getAttribute('class')).toBe('pw-zzz-mark');
  });
});

/** The sleeping plume holds its position while the body moves beneath it. It alternates between
 * sleep marks and a dream glyph, with a breath bubble during the transition. */
describe('the sleeper\'s plume', () => {
  const plume = (c: HTMLElement) => part(c, 'dream-badge');

  afterEach(() => { act(() => { setIntentDream('off'); }); });

  it('stands beside the pose rather than inside it', () => {
    act(() => { setIntentDream('zzz'); });
    const { container } = render(<Character pose="sleeping" size={60} />);
    const flip = part(container, 'flip');
    expect(plume(container).parentElement).toBe(flip.parentElement);
    expect(flip.contains(plume(container))).toBe(false);
    // And the pose's own badge stands down, so one shoulder never carries two.
    expect(part(container, 'badge').style.opacity).toBe('0');
  });

  /** The disc is the same element before and after, which is what gives its transition a state to
   *  arrive from. */
  it('keeps the glyph\'s disc mounted so it can arrive, and swaps it in for the zzz', () => {
    act(() => { setIntentDream('zzz'); });
    const { container, rerender } = render(<Character pose="sleeping" size={60} />);
    const disc = part(container, 'dream-glyph');
    expect(disc.style.opacity).toBe('0');
    expect(part(container, 'dream-zzz').style.opacity).toBe('1');

    act(() => { setIntentDream('pw-road'); });
    rerender(<Character pose="sleeping" size={60} />);
    expect(part(container, 'dream-glyph')).toBe(disc);
    expect(disc.style.opacity).toBe('1');
    expect(disc.style.transform).toBe('none');
    expect(part(container, 'dream-zzz').style.opacity).toBe('0');
  });

  it('breathes once as the zzz come back, and not on the way out', () => {
    act(() => { setIntentDream('pw-road'); });
    const { container, rerender } = render(<Character pose="sleeping" size={60} />);
    const breaths = () => animateCalls.filter((a) => a.part === 'dream-puff').length;
    expect(breaths()).toBe(0);

    act(() => { setIntentDream('zzz'); });
    rerender(<Character pose="sleeping" size={60} />);
    expect(breaths()).toBe(1);
    expect(part(container, 'dream-puff')).toBeTruthy();
  });

  it('cuts every plume beat under reduced motion', () => {
    act(() => { setIntentDream('zzz'); });
    const { container } = render(
      <MotionConfig reducedMotion="always"><Character pose="sleeping" size={60} /></MotionConfig>,
    );
    expect(part(container, 'dream-zzz').style.transition).toBe('none');
    expect(part(container, 'dream-glyph').style.transition).toBe('none');
  });
});
