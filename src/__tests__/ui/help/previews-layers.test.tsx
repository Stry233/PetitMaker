// @vitest-environment jsdom
/**
 * The layers Help figure drives one pictured shell through the layer control's own press targets: a
 * single shell mounts collapsed like the live app, and each beat's scripted press reaches Rail's
 * handlers through the inert pictured wrappers.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { setStoreState } from '../../_support/store';
import { LayersTour } from '../../../ui/help/figures/previews/frame-tours';

// The mount transforms the whole shell graph.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  // Real timers would make each beat of the walk a real 2.8s wait.
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mountTour() {
  setStoreState({ locale: 'en' });
  return render(
    <I18nProvider>
      <LayersTour />
    </I18nProvider>,
  );
}

const count = (selector: string) => document.querySelectorAll(selector).length;

describe('LayersTour', () => {
  it('mounts one shell, collapsed, and the first beat presses the readout open', async () => {
    mountTour();
    // One readout means one shell, not a posed shell per size.
    expect(count('[data-testid="shell-layer-readout"]')).toBe(1);
    expect(count('[data-testid="shell-layer-panel"]')).toBe(0);

    // Past the first beat's press (down at 1150ms, up and click at 1300ms).
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(count('[data-testid="shell-layer-panel"]')).toBe(1);
    // Once open, the panel replaces the collapsed readout.
    expect(count('[data-testid="shell-layer-readout"]')).toBe(0);
  });

  it('the second beat presses bigger and the ladder tops out at the grid', async () => {
    mountTour();
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(count('[data-testid="shell-layer-panel"]')).toBe(1);

    // The next beat starts at 2800ms and presses 1300ms in. Two advances, because an effect schedules
    // the press timers only after the first advance flushes.
    await act(async () => { vi.advanceTimersByTime(1400); });
    await act(async () => { vi.advanceTimersByTime(1400); });
    const bigger = document.querySelector('[data-testid="shell-layer-bigger"]');
    // A disabled grow arrow shows the press reached the top rung, `grid`.
    expect(bigger?.hasAttribute('disabled')).toBe(true);
  });
});
