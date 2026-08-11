// SettingsModal — "Local data" two-step erase confirm.
//
// Covers the confirm-step state machine (collapsed → expanded → cancel/confirm)
// AND guards the height-animation fix: the expanding panel must drive Framer's
// `height` with a definite NUMBER, never the literal string `'auto'` — Framer's
// own auto-height measurement is zoom-blind (see SettingsModal.tsx), which is
// what caused the reported terminal jump when `ModalShell`'s card zoom scaled
// the measured value a second time.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SettingsModal, CARD_ROW_GAP, type SettingsModalProps } from '../../../ui/chrome/modals/SettingsModal';
import { I18nProvider } from '../../../i18n/context';

vi.mock('../../../io/local-reset', () => ({ resetAllLocalData: vi.fn(() => new Promise(() => {})) }));
import { resetAllLocalData } from '../../../io/local-reset';
import { setStoreState } from '../../_store';

function noop() {}

function renderModal(overrides: Partial<SettingsModalProps> = {}) {
  const props: SettingsModalProps = {
    open: true,
    locale: 'en',
    showGrid: false,
    showChunks: false,
    motionPref: 'system',
    systemCursors: false,
    onLocaleChange: noop,
    onShowGridChange: noop,
    onShowChunksChange: noop,
    onMotionPrefChange: noop,
    onSystemCursorsChange: noop,
    onAbout: noop,
    onClose: noop,
    ...overrides,
  };
  return render(
    <I18nProvider>
      <SettingsModal {...props} />
    </I18nProvider>,
  );
}

// The animating wrapper is the parent of the tinted warning box, itself the
// parent of the warning text span.
function findWrapper(): HTMLElement {
  const warn = screen.getByText(/Removes everything this app stored/);
  return warn.parentElement!.parentElement as HTMLElement;
}

beforeEach(() => {
  setStoreState({ locale: 'en', uiZoom: 1 });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('SettingsModal — erase-confirm state machine', () => {
  it('starts collapsed: only the "Erase & restart…" chip is visible', () => {
    renderModal();
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
    expect(screen.queryByText(/Removes everything this app stored/)).toBeNull();
  });

  it('expands to the warning + Cancel/Confirm on click, collapsing the chip', () => {
    renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    expect(screen.queryByText('Erase & restart…')).toBeNull();
    expect(screen.getByText(/Removes everything this app stored/)).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Erase everything')).toBeTruthy();
  });

  it('Cancel returns to the collapsed chip', () => {
    renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    fireEvent.click(screen.getByText('Cancel'));
    // The chip button is un-animated (a plain `!confirmReset &&` conditional),
    // so it reappears synchronously; the warning panel below it may still be
    // mid-exit (AnimatePresence keeps it mounted for its own exit animation),
    // which is a Framer/jsdom timing detail unrelated to this state machine.
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
  });

  it('Confirm calls resetAllLocalData and swaps the buttons for a spinner', () => {
    renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    fireEvent.click(screen.getByText('Erase everything'));
    expect(resetAllLocalData).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.queryByText('Erase everything')).toBeNull();
  });

  it('reopening after a cancel resets state fresh (open toggled false→true)', () => {
    const { rerender } = renderModal();
    fireEvent.click(screen.getByText('Erase & restart…'));
    expect(screen.getByText(/Removes everything this app stored/)).toBeTruthy();

    rerender(
      <I18nProvider>
        <SettingsModal
          open={false}
          locale="en"
          showGrid={false}
          showChunks={false}
          motionPref="system"
          systemCursors={false}
          onLocaleChange={noop}
          onShowGridChange={noop}
          onShowChunksChange={noop}
          onMotionPrefChange={noop}
          onSystemCursorsChange={noop}
          onAbout={noop}
          onClose={noop}
        />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider>
        <SettingsModal
          open={true}
          locale="en"
          showGrid={false}
          showChunks={false}
          motionPref="system"
          systemCursors={false}
          onLocaleChange={noop}
          onShowGridChange={noop}
          onShowChunksChange={noop}
          onMotionPrefChange={noop}
          onSystemCursorsChange={noop}
          onAbout={noop}
          onClose={noop}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Erase & restart…')).toBeTruthy();
  });

  // Regression guard for the terminal-jump fix: the expanding wrapper's `height`
  // must be a definite pixel number at every point, NEVER the literal string
  // `'auto'` — that string is what let Framer's zoom-blind auto measurement
  // double-apply the modal card's CSS `zoom` and snap on completion.
  it('drives the expand panel height as a definite number, never the literal "auto"', () => {
    renderModal();
    act(() => {
      fireEvent.click(screen.getByText('Erase & restart…'));
    });
    const wrapper = findWrapper();
    expect(wrapper.style.height).not.toBe('auto');
    expect(wrapper.style.height.endsWith('px')).toBe(true);
  });

  // Regression guard for the COLLAPSE terminal-jump. Steady state: `marginTop:
  // -12px` only cancels 12 of the parent card's `gap: CARD_ROW_GAP` (22px)
  // between rows — the other 10px is the deliberate "tight" resting gap under
  // the row above, and it's OUTSIDE the height-animated box. The old code left
  // `marginTop` static at -12 for the exit too, so the box's occupied span
  // (gap + marginTop + height) never reached the post-unmount single-gap
  // baseline before AnimatePresence removed it — a jump of exactly the
  // uncancelled 10px. The fix's exit target rides `marginTop` to
  // `-CARD_ROW_GAP` (fully cancelling the gap) in lockstep with `height: 0`,
  // so by construction (gap + marginTop + height) → (22 + -22) + 0 == 0,
  // matching what the parent's flex gap alone contributes once the wrapper is
  // gone. Verified by sampling the REAL exit animation (no
  // `MotionGlobalConfig.skipAnimations` — that jumps straight through the exit
  // frame to unmount in one microtask and can't observe it); capturing at
  // least one in-flight frame is itself part of the guard — this is what actually
  // catches a regression: the pre-fix code left `marginTop` static at -12 AND
  // used the bouncy entrance spring (not the slower no-overshoot
  // `exitTransition`) for exit too, so it unmounted within a few ms, before
  // any 8ms-spaced sample could land — reverting either half of the fix
  // reproduces that and fails the `samples.length` / "moved off -12" checks
  // below, not just a hardcoded style snapshot.
  it('collapse: live-sampled marginTop rides to the flush target, never regresses toward the open gap, never overshoots', async () => {
    renderModal();
    act(() => {
      fireEvent.click(screen.getByText('Erase & restart…'));
    });
    const wrapper = findWrapper();
    const parent = wrapper.parentElement as HTMLElement;
    const parentGap = parseFloat(parent.style.gap); // CARD_ROW_GAP, read straight off the DOM
    expect(parentGap).toBe(CARD_ROW_GAP);
    // Resting OPEN gap is untouched by this fix — same -12px as before.
    expect(wrapper.style.marginTop).toBe('-12px');

    act(() => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await new Promise((r) => setTimeout(r, 8));
      });
      const warn = screen.queryByText(/Removes everything this app stored/);
      if (!warn) break; // exit completed and AnimatePresence unmounted it
      const w = warn.parentElement!.parentElement as HTMLElement;
      samples.push(parseFloat(w.style.marginTop));
    }

    // Fully unmounted by the time sampling stops.
    expect(screen.queryByText(/Removes everything this app stored/)).toBeNull();

    // Must have actually captured the exit in flight — a regression that
    // drops the exit-specific `exitTransition` (falling back to the fast
    // entrance spring) unmounts before the first 8ms sample, which would
    // otherwise vacuously "pass" an empty-samples check.
    expect(samples.length).toBeGreaterThan(0);
    // Never regress toward the open gap, never overshoot past the fully
    // flush target (small float slack for spring/ease rounding).
    for (const m of samples) {
      expect(m).toBeLessThanOrEqual(-12);
      expect(m).toBeGreaterThanOrEqual(-parentGap - 0.5);
    }
    // Actually moved off the open resting value toward the flush target —
    // which a static `marginTop: -12` exit could never do.
    expect(samples[samples.length - 1]).toBeLessThan(-12);
    // Monotonically non-increasing — the occupied space only ever shrinks.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]! + 0.01);
    }
  });
});
