/**
 * A button that presses itself is only acceptable if it can be stopped, and if the press it makes
 * is the press a finger makes. Those two are what these pin, plus the one thing a screen reader
 * needs from it.
 *
 * jsdom lays nothing out, so the RING is not testable here beyond its presence: the outline is
 * measured off the rendered element and comes out zero-sized. What is testable is the clock, the
 * three ways of interrupting it, and where the description node lives.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider, translate } from '../../../i18n/context';
import { TimedButton } from '../../../ui/primitives/TimedButton';
import { colors } from '../../../ui/design/styles';

/** jsdom re-serializes a hex fill as `rgb(...)`, so the fired fill is compared in that form rather
 *  than spelled out a second time. */
const FIRED_RGB = (() => {
  const probe = document.createElement('div');
  probe.style.backgroundColor = colors.tileYellow;
  return probe.style.backgroundColor;
})();

/** rAF is what drives the countdown, so the fake clock has to drive rAF. */
beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

function mount(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

/** Let `ms` of countdown pass. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('a timed button', () => {
  it('holds automatic and manual activation while disabled', () => {
    const onPress = vi.fn();
    const view = mount(<TimedButton after={2} disabled onPress={onPress}>Continue</TimedButton>);
    fireEvent.click(screen.getByRole('button'));
    run(3000);
    expect(onPress).not.toHaveBeenCalled();
    view.rerender(<I18nProvider><TimedButton after={2} onPress={onPress}>Continue</TimedButton></I18nProvider>);
    run(1000);
    expect(onPress).not.toHaveBeenCalled();
    run(1200);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('presses itself once the time is up, through a real click', () => {
    const onPress = vi.fn();
    mount(<TimedButton after={2} onPress={onPress}>Dismiss</TimedButton>);
    run(1000);
    expect(onPress).not.toHaveBeenCalled();
    run(1200);
    expect(onPress).toHaveBeenCalledTimes(1);
    // A click on the element, not a call of the handler: the two must not be separate paths, and a
    // click is what carries the browser's own press behaviour with it.
    run(5000);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('says whether the press was its own or a hand\'s', () => {
    // Nothing in a click event carries this, and a host must not guess from its internals: the
    // arrival notice answers the saved-session offer beside it when a HAND takes its OK, and a
    // countdown running out is nobody answering anything. Callers that mean the same thing by both
    // (the restore card, the dev-build notice) simply ignore the argument.
    const onPress = vi.fn();
    mount(<TimedButton after={2} onPress={onPress}>Dismiss</TimedButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenLastCalledWith(false);
    run(2200);
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onPress).toHaveBeenLastCalledWith(true);
  });

  it('holds the clock while the pointer is on it, and resumes where it left off', () => {
    const onPress = vi.fn();
    mount(<TimedButton after={2} onPress={onPress}>Dismiss</TimedButton>);
    const btn = screen.getByRole('button');
    run(1000);
    fireEvent.pointerEnter(btn);
    run(10_000);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.pointerLeave(btn);
    // A pause, not a restart: what is left of the two seconds is one, so half that is not enough.
    run(600);
    expect(onPress).not.toHaveBeenCalled();
    run(600);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('holds the clock while the host says someone is reading', () => {
    const onPress = vi.fn();
    const { rerender } = mount(<TimedButton after={2} paused onPress={onPress}>Dismiss</TimedButton>);
    run(10_000);
    expect(onPress).not.toHaveBeenCalled();
    rerender(<I18nProvider><TimedButton after={2} onPress={onPress}>Dismiss</TimedButton></I18nProvider>);
    run(2200);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('cancels for good the moment the keyboard reaches it', () => {
    const onPress = vi.fn();
    mount(<TimedButton after={2} onPress={onPress}>Dismiss</TimedButton>);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    run(30_000);
    expect(onPress).not.toHaveBeenCalled();
    // And blurring does not put it back: a considered offer stays declined.
    fireEvent.blur(btn);
    run(30_000);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(translate('timed.stopped'));
  });

  it('says what it will do without saying it as the button\'s name', () => {
    mount(<TimedButton after={9} onPress={() => {}} aria-label="Dismiss">Dismiss</TimedButton>);
    const btn = screen.getByRole('button');
    const hint = screen.getByRole('status');
    // OUTSIDE the button: a node inside one is part of its accessible name, so a description
    // written there would be read as though it were the label.
    expect(btn.contains(hint)).toBe(false);
    expect(btn.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.textContent).toBe(translate('timed.self_press', { seconds: 9 }));
  });

  it('does not count at all when no time is given', () => {
    const onPress = vi.fn();
    mount(<TimedButton after={0} onPress={onPress}>Dismiss</TimedButton>);
    run(30_000);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull();
  });
});

describe('the position a caller asks for', () => {
  it('defaults to relative, so the ring/stadium svg has a containing block for free', () => {
    mount(<TimedButton after={2} onPress={() => {}}>go</TimedButton>);
    expect(screen.getByRole('button').style.position).toBe('relative');
  });

  it('survives the merge when a caller names its own, absolute included', () => {
    // A band-sized button (RestoreShelf) is positioned absolute against its wrapper and stretched
    // by left/right rather than a width; `relative` winning here silently collapses it to zero
    // width, since every one of its children is itself absolutely positioned out of flow.
    mount(
      <TimedButton after={2} onPress={() => {}} style={{ position: 'absolute', left: 0, right: 0 }}>
        go
      </TimedButton>,
    );
    expect(screen.getByRole('button').style.position).toBe('absolute');
  });
});

describe('a clock the caller owns', () => {
  // Same layout gap as the stadium's tests: nothing is laid out, so the drawing needs a width.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  });

  const ring = () => screen.getByRole('button').querySelector('svg rect') as SVGRectElement;

  it('draws the fraction it is handed, spent from whole', () => {
    mount(<TimedButton after={9} external={{ fraction: 0.4 }} onPress={() => {}}>Retry now</TimedButton>);
    expect(ring().getAttribute('stroke-dashoffset')).toBe('0.4');
  });

  it('never presses itself: the clock that fires is the caller s', () => {
    const onPress = vi.fn();
    mount(<TimedButton after={2} external={{ fraction: 0 }} onPress={onPress}>Retry now</TimedButton>);
    run(30_000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not pause under the pointer, because the pointer does not hold the caller s clock', () => {
    const { rerender } = mount(
      <TimedButton after={9} external={{ fraction: 0.2 }} onPress={() => {}}>Retry now</TimedButton>,
    );
    fireEvent.pointerEnter(screen.getByRole('button'));
    rerender(
      <I18nProvider>
        <TimedButton after={9} external={{ fraction: 0.7 }} onPress={() => {}}>Retry now</TimedButton>
      </I18nProvider>,
    );
    expect(ring().getAttribute('stroke-dashoffset')).toBe('0.7');
  });

  it('does not cancel on focus, and does not tell a reader it stopped', () => {
    const { rerender } = mount(
      <TimedButton after={9} external={{ fraction: 0.2 }} onPress={() => {}}>Retry now</TimedButton>,
    );
    fireEvent.focus(screen.getByRole('button'));
    rerender(
      <I18nProvider>
        <TimedButton after={9} external={{ fraction: 0.9 }} onPress={() => {}}>Retry now</TimedButton>
      </I18nProvider>,
    );
    expect(ring().getAttribute('stroke-dashoffset')).toBe('0.9');
    // A cancelled self-clocked button says so. Saying it here would be a lie: the loop retries
    // whether the keyboard reached this pill or not, and nothing about the focus stopped it.
    expect(screen.getByRole('status').textContent).toBe(translate('timed.self_press', { seconds: 9 }));
  });

  it('says EMPTY MEANS FIRED with the lit fill, the ring spent to nothing', () => {
    mount(<TimedButton after={9} external={{ fraction: 1 }} onPress={() => {}}>Retry now</TimedButton>);
    expect(ring().getAttribute('stroke-dashoffset')).toBe('1');
    expect(ring().style.visibility).toBe('hidden');
    expect(screen.getByRole('button').style.backgroundColor).toBe(FIRED_RGB);
  });

  it('holds a fraction outside 0..1 to the ends of the ring', () => {
    const { rerender } = mount(
      <TimedButton after={9} external={{ fraction: -3 }} onPress={() => {}}>Retry now</TimedButton>,
    );
    expect(ring().getAttribute('stroke-dashoffset')).toBe('0');
    rerender(
      <I18nProvider>
        <TimedButton after={9} external={{ fraction: 4 }} onPress={() => {}}>Retry now</TimedButton>
      </I18nProvider>,
    );
    expect(ring().getAttribute('stroke-dashoffset')).toBe('1');
  });

  it('leaves a hand s press meaning what it always did', () => {
    const onPress = vi.fn();
    mount(<TimedButton after={9} external={{ fraction: 0.5 }} onPress={onPress}>Retry now</TimedButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenLastCalledWith(false);
  });
});

describe('the stadium clock', () => {
  // jsdom lays nothing out, so `offsetWidth` is 0 everywhere and the clock svg (gated on
  // `box.w > 0`) never renders. Give every element a fixed width for these two tests.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  });

  it('draws the shelf\'s own mark under the button instead of the outline ring', () => {
    render(
      <I18nProvider>
        <TimedButton after={5} onPress={() => {}} clock="stadium" data-testid="marked">
          go
        </TimedButton>
      </I18nProvider>,
    );
    const btn = screen.getByTestId('marked');
    const mark = btn.querySelector('svg line');
    expect(mark, 'the mark is a line, capped round into a stadium').toBeTruthy();
    expect(mark!.getAttribute('stroke-linecap')).toBe('round');
    // WHOLE, and spent from there: the dash is the whole mark and the offset walks it off the end,
    // so an offset of 1 leaves nothing drawn. EMPTY MEANS FIRED.
    expect(mark!.getAttribute('stroke-dashoffset')).toBe('0');
    expect(btn.querySelector('svg rect'), 'the ring is not also drawn').toBeNull();
  });

  it('keeps the outline ring as the default drawing', () => {
    render(
      <I18nProvider>
        <TimedButton after={5} onPress={() => {}} data-testid="ringed">
          go
        </TimedButton>
      </I18nProvider>,
    );
    const btn = screen.getByTestId('ringed');
    expect(btn.querySelector('svg rect'), 'the ring is the default').toBeTruthy();
    expect(btn.querySelector('svg line')).toBeNull();
  });
});

/**
 * THE LENT FUSE RUNS BETWEEN THE CALLER'S SAMPLES.
 *
 * A process clock is sampled at whatever rate its owner repaints — the retry face reads its backoff
 * once a second — so a ring redrawn only on those samples is a staircase, which is the drawing
 * REDUCED motion is supposed to be alone in getting. `spanMs` turns the handed fraction into a rate
 * and a rAF walks the outline on from it. The rendered ATTRIBUTE is the sample; the inline STYLE is
 * the walk, and it wins in the cascade, which is why the two are read separately here.
 */
describe('the lent fuse glides between the samples it is given', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  });

  const ring = () => screen.getByRole('button').querySelector('svg rect') as SVGRectElement;
  const drawn = () => Number(ring().style.strokeDashoffset);

  function mountLent(reducedMotion: 'never' | 'always', fraction: number, spanMs: number) {
    return render(
      <MotionConfig reducedMotion={reducedMotion}>
        <I18nProvider>
          <TimedButton after={9} external={{ fraction, spanMs }} onPress={() => {}}>
            Retry now
          </TimedButton>
        </I18nProvider>
      </MotionConfig>,
    );
  }

  it('walks the outline on between two 1Hz samples, at the caller s own rate', () => {
    // A nine-second backoff, sampled at three seconds spent.
    mountLent('never', 3 / 9, 9_000);
    expect(drawn()).toBeCloseTo(3 / 9, 3);

    // Half a second later, with NO new sample: the fuse has spent half a second of the nine.
    run(500);
    const mid = drawn();
    expect(mid, 'the ring moved between samples').toBeGreaterThan(3 / 9);
    expect(mid).toBeCloseTo(3.5 / 9, 2);

    // And again, so the movement is a walk rather than one jump.
    run(500);
    expect(drawn()).toBeGreaterThan(mid);
    expect(drawn()).toBeCloseTo(4 / 9, 2);
  });

  it('never walks past empty, whatever the caller does next', () => {
    mountLent('never', 8.5 / 9, 9_000);
    run(30_000);
    expect(drawn()).toBe(1);
    expect(ring().style.visibility).toBe('hidden');
  });

  it('is re-seated by the next sample rather than accumulating its own drift', () => {
    const { rerender } = mountLent('never', 0.2, 9_000);
    run(2_000);
    expect(drawn()).toBeGreaterThan(0.2);
    // The caller's next reading says LESS is spent than the walk had drawn (a longer backoff on the
    // next attempt). The sample is the truth: the walk restarts from it.
    rerender(
      <MotionConfig reducedMotion="never">
        <I18nProvider>
          <TimedButton after={9} external={{ fraction: 0.05, spanMs: 9_000 }} onPress={() => {}}>
            Retry now
          </TimedButton>
        </I18nProvider>
      </MotionConfig>,
    );
    expect(drawn()).toBeCloseTo(0.05, 3);
    expect(ring().style.visibility).toBe('');
  });

  it('STEPS under reduced motion, which is the same drawing the caller s sample rate makes', () => {
    mountLent('always', 3 / 9, 9_000);
    expect(drawn()).toBeCloseTo(3 / 9, 3);
    run(900);
    expect(drawn(), 'nothing moved between samples').toBeCloseTo(3 / 9, 3);
  });

  it('draws the handed fraction and nothing more when no span is lent', () => {
    render(
      <MotionConfig reducedMotion="never">
        <I18nProvider>
          <TimedButton after={9} external={{ fraction: 0.4 }} onPress={() => {}}>
            Retry now
          </TimedButton>
        </I18nProvider>
      </MotionConfig>,
    );
    run(2_000);
    expect(Number(ring().style.strokeDashoffset)).toBeCloseTo(0.4, 3);
  });
});
