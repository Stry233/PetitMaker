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
import { I18nProvider, translate } from '../../../i18n/context';
import { TimedButton } from '../../../ui/primitives/TimedButton';

/** rAF is what drives the countdown, so the fake clock has to drive rAF. */
beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

function mount(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

/** Let `ms` of countdown pass. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('a timed button', () => {
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
