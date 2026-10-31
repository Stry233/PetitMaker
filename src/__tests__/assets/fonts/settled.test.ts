// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { onFontsSettled } from '../../../assets/fonts/settled';

/** A font set whose `ready` resolves when `settle` is called, and which dispatches `loadingdone`. */
function fontSet() {
  const target = new EventTarget();
  let settle!: () => void;
  const ready = new Promise<void>((resolve) => { settle = resolve; });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: Object.assign(target, { ready }),
  });
  return { settle, batchDone: () => target.dispatchEvent(new Event('loadingdone')) };
}

afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; });

describe('the fonts-settled signal', () => {
  it('fires when the fonts loading now settle, again after each later batch, and never after unsubscribe', async () => {
    const fonts = fontSet();
    const listener = vi.fn();
    const stop = onFontsSettled(listener);
    expect(listener).not.toHaveBeenCalled();
    fonts.settle();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    fonts.batchDone();
    expect(listener).toHaveBeenCalledTimes(2);
    fonts.batchDone();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    fonts.batchDone();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('never fires once unsubscribed before the first settle', async () => {
    const fonts = fontSet();
    const listener = vi.fn();
    onFontsSettled(listener)();
    fonts.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(listener).not.toHaveBeenCalled();
  });
});
