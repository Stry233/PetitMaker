// @vitest-environment jsdom
/**
 * jsdom has no Web Animations API, so this polyfills the slice `Character.tsx` calls: a fake
 * `Animation` that records keyframes and options, tracks `playState`, and for a forwards fill
 * finishes after `duration` (on `setTimeout`, so fake timers drive it) and then holds its last
 * keyframe over the inline style until cancelled, as a real one does.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, renderHook, act, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { Character } from '../../../../ui/agent/character/Character';
import { useCharacterChannel, type CharacterChannel } from '../../../../ui/agent/character/intent';
import { MICRO, POSE_DWELL, POSES, PRESS_SQUASH, WAKE_BEAT, poseForPhase, type PoseName } from '../../../../ui/agent/character/poses';
import type { SessionPhase } from '../../../../agent/core/project-view';
import { amplitude, framerMotion } from '../../../../ui/design/motion';
import { pressable } from '../../../../ui/design/styles';

/** The live channel, as a surface outside any picture holds it. */
let live: CharacterChannel;
beforeAll(() => { live = renderHook(useCharacterChannel).result.current; });

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
    // As in the real API, only a bounded animation settles to 'finished' by itself.
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
/** Every `.animate()` call made in the character since the last reset. */
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

/** The element's effective transform: a finished `forwards`/`both` animation overrides the inline
 *  style until cancelled, so a stale `scale(0)` hold is visible here. */
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

  /** Two poses belong to the setup screen and one to region marking; no phase may claim them. */
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

    // The first badge lands synchronously: nothing to swap out yet.
    expect(container.querySelector('img[data-badge="idea"]')).not.toBeNull();
    expect(visualTransform(badgeEl)).toBe('scale(1)');

    // A second pose before the first badge's pop-in finishes arms the swap-out (fill 'forwards',
    // 110ms) whose hold must be cancelled. The pose is worn, and the swap armed, one `POSE_DWELL` later.
    act(() => { rerender(<Character pose="working" size={64} />); });
    act(() => { vi.advanceTimersByTime(POSE_DWELL); });

    act(() => { vi.advanceTimersByTime(60); });
    expect(container.querySelector('img[data-badge="idea"]'), 'still showing the outgoing badge mid-swap').not.toBeNull();

    // Past `BADGE_SWAP_OUT_MS + BADGE_SWAP_GAP_MS` (170ms), when the new badge pops in.
    act(() => { vi.advanceTimersByTime(200); });

    expect(container.querySelector('[data-badge="refresh"]'), 'the new badge is showing').not.toBeNull();
    expect(visualTransform(badgeEl)).not.toBe('scale(0)');
    expect(visualTransform(badgeEl)).toBe('scale(1)');
  });
});

/**
 * A pose is never cut short. Within one model turn the phase flips between `streaming` and
 * `executing` several times a second; adopting each flip would restart every animation on her.
 */
describe('the pose engine under a phase that flaps', () => {
  // The clock is faked with the timers because the dwell is measured against `performance.now()`.
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
      // Commit before advancing, so the effect sees the change when it arrives.
      act(() => { rerender(<Character pose={pose} size={64} />); });
      act(() => { vi.advanceTimersByTime(every); });
    }
    // Both poses loop on `body`, so one infinite `body` loop is one landing; at most one per dwell,
    // plus the one in flight.
    const landings = animateCalls.filter((a) => a.iterations === Infinity && a.part === 'body').length;
    expect(landings).toBeLessThanOrEqual(Math.ceil(span / POSE_DWELL) + 1);
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
    // Four phase changes inside one dwell.
    act(() => {
      for (const pose of ['working', 'thinking', 'working', 'thinking'] as const) {
        rerender(<Character pose={pose} size={64} />);
        vi.advanceTimersByTime(40);
      }
    });
    expect(running()).toBe(before);
    expect(animateCalls.filter((a) => a.iterations === Infinity)).toHaveLength(0);
  });

  /** The flick shares the breath's part and property, so replacing the transform would snap the
   *  breath to rest for the flick's duration. */
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
    // No blink timer: the lids are already down.
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

/** StrictMode's dev-only remount cancels every animation and timer, then reruns the effects on the
 *  same instance, whose `worn` ref still claims the pose; the engine must rebuild it. */
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
    act(() => { live.cue({ kind: 'wake' }); });
    const beats = animateCalls.filter((a) => a.part === 'pose');
    expect(beats).toHaveLength(1);
    expect(beats[0]?.duration).toBe(WAKE_BEAT.dur);
    expect(beats[0]?.easing).toBe(WAKE_BEAT.easing);
    expect(beats[0]?.keyframes).toEqual(WAKE_BEAT.keyframes);

    // Landing on `idle` cancels the sleep pose's forwards-filled droop; the beat plays on.
    act(() => { rerender(<Character pose="idle" size={64} />); });
    const poseEl = part(container, 'pose');
    expect(poseEl.getAnimations().map((a) => a.playState)).toEqual(['running']);
    expect(part(container, 'lid-l').style.transform).toBe('scaleY(0)');
    expect(part(container, 'lid-r').style.transform).toBe('scaleY(0)');
  });

  it('plays nothing when she is already awake', () => {
    render(<Character pose="idle" size={64} />);
    animateCalls = [];
    act(() => { live.cue({ kind: 'wake' }); });
    expect(animateCalls.filter((a) => a.part === 'pose')).toHaveLength(0);
  });

  it('is skipped outright under reduced motion', () => {
    render(
      <MotionConfig reducedMotion="always"><Character pose="sleeping" size={64} /></MotionConfig>,
    );
    animateCalls = [];
    act(() => { live.cue({ kind: 'wake' }); });
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

  /** A surface that owns the press (the keyless rest's Connect) cues the same squash. */
  it('acknowledges a cue too', () => {
    render(<Character pose="idle" size={64} />);
    animateCalls = [];
    act(() => { live.cue({ kind: 'acknowledge' }); });
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

/** The sleeping plume holds its position while the body moves beneath it. It alternates between
 * sleep marks and a dream glyph, with a breath bubble during the transition. */
describe('the sleeper\'s plume', () => {
  afterEach(() => { act(() => { live.setDream('off'); }); });

  it('cuts every plume beat under reduced motion', () => {
    act(() => { live.setDream('zzz'); });
    const { container } = render(
      <MotionConfig reducedMotion="always"><Character pose="sleeping" size={60} /></MotionConfig>,
    );
    expect(part(container, 'dream-zzz').style.transition).toBe('none');
    expect(part(container, 'dream-glyph').style.transition).toBe('none');
  });
});
