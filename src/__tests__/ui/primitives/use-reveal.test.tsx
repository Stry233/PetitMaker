// @vitest-environment jsdom
/** The reveal shows on hover in PC mode and on a held press in touch mode, and on a keyboard's focus in either. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useReveal } from '../../../ui/primitives/use-reveal';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { focusLooksKeyboard } from '../../_support/focus-visible';

const HOLD = GESTURE_TIMING.touch.holdMs;

function Reveal({ onClick, keepsClick, onChange }: { onClick?: () => void; keepsClick?: boolean; onChange?: (shown: boolean) => void }) {
  const { shown, bind } = useReveal({ keepsClick, onChange });
  return <button type="button" data-shown={shown} onClick={onClick} {...bind}>probe</button>;
}

function Probe({ touch, ...rest }: { touch: boolean; onClick?: () => void; keepsClick?: boolean; onChange?: (shown: boolean) => void }) {
  return <InputModeProvider inputMode={touch ? 'touch' : 'pc'}><Reveal {...rest} /></InputModeProvider>;
}

const shown = (el: HTMLElement) => el.dataset.shown === 'true';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useReveal', () => {
  it('shows on hover in PC mode and hides on leave', () => {
    const { getByRole } = render(<Probe touch={false} />);
    const el = getByRole('button');
    fireEvent.pointerEnter(el);
    expect(shown(el)).toBe(true);
    fireEvent.pointerLeave(el);
    expect(shown(el)).toBe(false);
  });

  it('ignores hover in touch mode and shows only once a press is held past the hold time', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { getByRole } = render(<Probe touch onClick={onClick} />);
    const el = getByRole('button');
    fireEvent.pointerEnter(el);
    fireEvent.pointerDown(el);
    act(() => { vi.advanceTimersByTime(HOLD - 50); });
    expect(shown(el)).toBe(false);
    act(() => { vi.advanceTimersByTime(100); });
    expect(shown(el)).toBe(true);
    // A finger's release, then its leave, then the click the browser makes of it.
    fireEvent.pointerUp(el);
    fireEvent.pointerLeave(el);
    fireEvent.click(el, { detail: 1 });
    expect(shown(el)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    // A later key press on the control is its own click.
    fireEvent.click(el, { detail: 0 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets the click ending a hold land where the hold only pauses or highlights', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { getByRole } = render(<Probe touch keepsClick onClick={onClick} />);
    const el = getByRole('button');
    fireEvent.pointerDown(el);
    act(() => { vi.advanceTimersByTime(HOLD + 50); });
    expect(shown(el)).toBe(true);
    fireEvent.pointerUp(el);
    fireEvent.click(el, { detail: 1 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets the click land when the hold opened nothing new', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { getByRole } = render(<Probe touch onClick={onClick} />);
    const el = getByRole('button');
    act(() => { el.focus(); });
    fireEvent.pointerDown(el);
    act(() => { vi.advanceTimersByTime(HOLD + 50); });
    fireEvent.pointerUp(el);
    fireEvent.click(el, { detail: 1 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets a short tap in touch mode through as a click and reveals nothing', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { getByRole } = render(<Probe touch onClick={onClick} />);
    const el = getByRole('button');
    // A tap focuses the control it lands on in some browsers, and that focus may show as the keyboard's.
    focusLooksKeyboard(true);
    fireEvent.pointerDown(el);
    act(() => { el.focus(); });
    expect(shown(el), 'the focus a press causes reveals nothing').toBe(false);
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerUp(el);
    fireEvent.click(el, { detail: 1 });
    act(() => { vi.advanceTimersByTime(HOLD); });
    expect(shown(el)).toBe(false);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows on a keyboard focus with no press in either mode', () => {
    for (const touch of [false, true]) {
      const { getByRole } = render(<Probe touch={touch} />);
      const el = getByRole('button');
      act(() => { el.focus(); });
      expect(shown(el)).toBe(true);
      act(() => { el.blur(); });
      expect(shown(el)).toBe(false);
      cleanup();
    }
  });

  it('tells onChange each time the reveal shows or hides, and not between', () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = render(<Probe touch={false} onChange={onChange} />);
    const el = getByRole('button');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerEnter(el);
    rerender(<Probe touch={false} onChange={onChange} />);
    fireEvent.pointerLeave(el);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });
});
