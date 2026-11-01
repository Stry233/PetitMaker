// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { SpeechBubble } from '../../../../ui/chrome/floating/SpeechBubble';
import { fittedUiScale } from '../../../../ui/design/scale';
import { JSDOM_WINDOW, atScale, sizeWindow } from '../../../_support/viewport';
import { TOUCH_UI_ZOOM_DEFAULT } from '../../../../platform/storage/prefs';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { GESTURE_TIMING } from '../../../../platform/input/gesture-timing';

const ANCHOR = { left: 700, top: 20, width: 40, height: 40, right: 740, bottom: 60, x: 700, y: 20, toJSON: () => ({}) } as DOMRect;

function renderBubble(props: Partial<Parameters<typeof SpeechBubble>[0]> = {}, inputMode: 'pc' | 'touch' = 'pc', anchor: DOMRect = ANCHOR) {
  const onAct = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <InputModeProvider inputMode={inputMode}>
          <div data-tour-target="menu" ref={(el) => { if (el) el.getBoundingClientRect = () => anchor; }} />
          <SpeechBubble anchor="menu" text="Immersive **mode** is recommended. Tap to enter." onAct={onAct} onClose={onClose} {...props} />
        </InputModeProvider>
      </I18nProvider>
    </MotionConfig>,
  );
  return { view, onAct, onClose };
}

afterEach(cleanup);

describe('SpeechBubble', () => {
  it('stands hidden until its anchor is measured, so it is there to leave if removed at once', () => {
    render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <SpeechBubble anchor="menu" text="Immersive **mode** is recommended." onAct={vi.fn()} onClose={vi.fn()} />
        </I18nProvider>
      </MotionConfig>,
    );
    expect(screen.getByTestId('speech-bubble').style.visibility).toBe('hidden');
  });

  it('[UI-27] draws at its own size on a phone at touch mode\'s default, and at the chrome zoom in PC mode', () => {
    sizeWindow(390, 844);
    atScale(TOUCH_UI_ZOOM_DEFAULT);
    renderBubble({}, 'touch');
    expect(Number(screen.getByTestId('speech-bubble').style.zoom)).toBeCloseTo(1, 6);
    cleanup();
    atScale(1);
    renderBubble({}, 'pc');
    expect(Number(screen.getByTestId('speech-bubble').style.zoom)).toBeCloseTo(fittedUiScale(390, 844, 1), 6);
    sizeWindow(JSDOM_WINDOW.w, JSDOM_WINDOW.h);
  });

  it('sets the marked run in bold', () => {
    renderBubble();
    const strong = screen.getByTestId('speech-bubble').querySelector('b');
    expect(strong?.textContent).toBe('mode');
  });

  it('acts and closes when the line is tapped', () => {
    const { onAct, onClose } = renderBubble();
    fireEvent.click(screen.getByRole('button', { name: 'Immersive mode is recommended. Tap to enter.' }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the round button, which carries the five-second clock', () => {
    const { onAct, onClose } = renderBubble();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAct).not.toHaveBeenCalled();
    expect(screen.getByText(/5 seconds/).textContent).toContain('5');
  });

  it('closes from a slow tap in touch mode: holding it pauses the clock and the press still lands', () => {
    vi.useFakeTimers();
    try {
      const { onClose } = renderBubble({}, 'touch');
      const close = screen.getByRole('button', { name: 'Close' });
      fireEvent.pointerDown(close, { pointerType: 'touch' });
      act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs + 100); });
      fireEvent.pointerUp(close, { pointerType: 'touch' });
      fireEvent.click(close, { detail: 1 });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes on a press anywhere else, which reaches nothing beneath, and stays for a press on itself', () => {
    const { onClose } = renderBubble();
    fireEvent.pointerDown(screen.getByTestId('speech-bubble'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
