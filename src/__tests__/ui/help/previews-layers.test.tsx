/**
 * The layers figure drives ONE pictured shell through the layer control's own press targets, so
 * the reader watches the control's real motion rather than a slideshow of poses. These pin the two
 * facts the walk stands on: a single shell mounts, booted collapsed like the live app, and a
 * beat's scripted press really moves the control's mode — the dispatched events reach Rail's own
 * handlers through the inert pictured wrappers.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { setStoreState } from '../../_store';
import { LayersTour } from '../../../ui/chrome/modals/help/figures/previews/frame-overview';

// The mount pays for transforming the whole shell graph, which the default budget has to cover on
// top of the walk itself.
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
    // One readout means one shell: the walk re-sizes the control by pressing it, not by
    // standing a posed shell per size.
    expect(count('[data-testid="shell-layer-readout"]')).toBe(1);
    expect(count('[data-testid="shell-layer-panel"]')).toBe(0);

    // Past the first beat's press (down at 1150ms, up and click at 1300ms).
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(count('[data-testid="shell-layer-panel"]')).toBe(1);
    // Open, the panel IS the control: the collapsed readout leaves with the pill.
    expect(count('[data-testid="shell-layer-readout"]')).toBe(0);
  });

  it('the second beat presses bigger and the ladder tops out at the grid', async () => {
    mountTour();
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(count('[data-testid="shell-layer-panel"]')).toBe(1);

    // The next beat starts at 2800ms and its press lands 1300ms in. Two advances: the beat's
    // press timers are scheduled by an effect, which runs only after the tick's advance flushes.
    await act(async () => { vi.advanceTimersByTime(1400); });
    await act(async () => { vi.advanceTimersByTime(1400); });
    const bigger = document.querySelector('[data-testid="shell-layer-bigger"]');
    // At the top rung the grow arrow is spent, which is what says the press reached `grid`.
    expect(bigger?.hasAttribute('disabled')).toBe(true);
  });
});
