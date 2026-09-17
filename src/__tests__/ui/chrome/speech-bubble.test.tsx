import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { SpeechBubble, BUBBLE_GAP_SHARE } from '../../../ui/chrome/floating/SpeechBubble';
import { fittedUiScale } from '../../../ui/design/scale';

const ANCHOR = { left: 700, top: 20, width: 40, height: 40, right: 740, bottom: 60, x: 700, y: 20, toJSON: () => ({}) } as DOMRect;

function renderBubble(props: Partial<Parameters<typeof SpeechBubble>[0]> = {}) {
  const onAct = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <div data-tour-target="menu" ref={(el) => { if (el) el.getBoundingClientRect = () => ANCHOR; }} />
        <SpeechBubble anchor="menu" text="Immersive **mode** is recommended. Tap to enter." onAct={onAct} onClose={onClose} {...props} />
      </I18nProvider>
    </MotionConfig>,
  );
  return { view, onAct, onClose };
}

afterEach(cleanup);

describe('SpeechBubble', () => {
  it('hangs under the anchor, right-aligned, with its tail on the anchor centre', () => {
    renderBubble();
    const bubble = screen.getByTestId('speech-bubble');
    const chrome = fittedUiScale(window.innerWidth, window.innerHeight, 1);
    expect(parseFloat(bubble.style.top)).toBeCloseTo((ANCHOR.bottom + ANCHOR.height * BUBBLE_GAP_SHARE) / chrome, 3);
    expect(parseFloat(bubble.style.right)).toBeCloseTo((window.innerWidth - ANCHOR.right) / chrome, 3);
    const tail = screen.getByTestId('speech-bubble-tail');
    expect(parseFloat(tail.style.right)).toBeGreaterThan(0);
  });

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

  it('closes on a press anywhere else and stays for a press on itself', () => {
    const { onClose } = renderBubble();
    fireEvent.pointerDown(screen.getByTestId('speech-bubble'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
