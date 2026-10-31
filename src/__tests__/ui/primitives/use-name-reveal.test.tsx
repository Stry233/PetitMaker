// @vitest-environment jsdom
/** A glyph control's name: a hover title in PC mode, a held bubble on the floating layer in touch mode. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { useNameReveal } from '../../../ui/primitives/use-name-reveal';
import { withBind } from '../../../ui/primitives/use-reveal';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { focusLooksKeyboard } from '../../_support/focus-visible';

function Stop({ onClick }: { onClick: () => void }) {
  const name = useNameReveal('Stop');
  return (
    <div data-testid="clip" style={{ overflow: 'hidden', width: 0 }}>
      <button type="button" aria-label="Stop" {...name.bind} onClick={onClick}>x{name.bubble}</button>
    </div>
  );
}

function OwnHandlers({ onPointerDown, onClick }: { onPointerDown: () => void; onClick: () => void }) {
  const name = useNameReveal('Stop');
  return <button type="button" aria-label="Stop" {...withBind(name.bind, { onPointerDown, onClick, onFocus: undefined })}>x{name.bubble}</button>;
}

const mount = (mode: 'pc' | 'touch', onClick = vi.fn()) =>
  render(<InputModeProvider inputMode={mode}><Stop onClick={onClick} /></InputModeProvider>);


afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useNameReveal', () => {
  spec('UI-29', 'in touch mode a held glyph control shows its name outside a clipping parent, and the release presses nothing', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    mount('touch', onClick);
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.getAttribute('title')).toBeNull();
    expect(document.body.childElementCount, 'no floating layer stands while the name is hidden').toBe(1);
    fireEvent.pointerDown(stop, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    const bubble = screen.getByText('Stop');
    expect(screen.getByTestId('clip').contains(bubble), 'the bubble stands outside the clipping parent').toBe(false);
    fireEvent.pointerUp(stop, { pointerType: 'touch' });
    fireEvent.click(stop, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
  });

  spec('UI-29', 'a control with its own press handlers still shows its held name and swallows the release', () => {
    vi.useFakeTimers();
    const onPointerDown = vi.fn();
    const onClick = vi.fn();
    render(<InputModeProvider inputMode="touch"><OwnHandlers onPointerDown={onPointerDown} onClick={onClick} /></InputModeProvider>);
    const stop = screen.getByRole('button', { name: 'Stop' });
    fireEvent.pointerDown(stop, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(screen.getByText('Stop')).toBeTruthy();
    fireEvent.pointerUp(stop, { pointerType: 'touch' });
    fireEvent.click(stop, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.pointerDown(stop, { pointerType: 'touch' });
    fireEvent.pointerUp(stop, { pointerType: 'touch' });
    fireEvent.click(stop, { detail: 1 });
    expect(onClick, 'a quick tap still reaches the caller').toHaveBeenCalledOnce();
  });

  spec('UI-29', 'a caller leaving a handler undefined keeps the reveal\'s', () => {
    focusLooksKeyboard(true);
    render(<InputModeProvider inputMode="touch"><OwnHandlers onPointerDown={() => {}} onClick={() => {}} /></InputModeProvider>);
    act(() => { screen.getByRole('button', { name: 'Stop' }).focus(); });
    expect(screen.getByText('Stop'), 'a keyboard focus names the control').toBeTruthy();
  });

  it('names the control by its hover title in PC mode and draws no bubble', () => {
    mount('pc');
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.getAttribute('title')).toBe('Stop');
    fireEvent.pointerEnter(stop);
    expect(screen.queryByText('Stop')).toBeNull();
  });

  spec('UI-29', 'in touch mode a window focusing its glyph control as it opens shows no name, and a keyboard focus does', () => {
    focusLooksKeyboard(false);
    mount('touch');
    const stop = screen.getByRole('button', { name: 'Stop' });
    act(() => { stop.focus(); });
    expect(screen.queryByText('Stop'), 'a focus the keyboard did not make names nothing').toBeNull();
    act(() => { stop.blur(); });
    vi.restoreAllMocks();
    focusLooksKeyboard(true);
    act(() => { stop.focus(); });
    expect(screen.getByText('Stop')).toBeTruthy();
  });
});
