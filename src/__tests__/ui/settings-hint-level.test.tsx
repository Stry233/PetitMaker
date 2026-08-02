// The quick-hints level: a persisted store field plus the Settings row that drives it.
// The store half asserts the persistence path directly (default, write-through, corrupt
// value); the row half renders the real controlled SettingsModal and asserts the segment
// click reaches the callback. Plain DOM checks (toBe / toBeTruthy) match sibling UI tests.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SettingsModal, type SettingsModalProps } from '../../ui/chrome/SettingsModal';
import { I18nProvider } from '../../i18n/context';
import { HINT_LEVEL_STORAGE_KEY, detectHintLevel, useEditorStore } from '../../state/store';
import { setStoreState } from '../_store';

function noop() {}

function renderModal(overrides: Partial<SettingsModalProps> = {}) {
  const props: SettingsModalProps = {
    open: true,
    locale: 'en',
    showGrid: false,
    showChunks: false,
    motionPref: 'system',
    systemCursors: false,
    classicCursors: false,
    hintLevel: 'full',
    onLocaleChange: noop,
    onShowGridChange: noop,
    onShowChunksChange: noop,
    onMotionPrefChange: noop,
    onSystemCursorsChange: noop,
    onClassicCursorsChange: noop,
    onHintLevelChange: noop,
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

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en', hintLevel: 'full' });
});

describe('hint level setting', () => {
  // The seeded store field can only report the seed, so the DEFAULT is asserted against
  // the detector the initializer calls, not against `getState()`.
  it('defaults to full with nothing, or nothing valid, stored', () => {
    expect(detectHintLevel()).toBe('full');
    localStorage.setItem(HINT_LEVEL_STORAGE_KEY, 'banana');
    expect(detectHintLevel()).toBe('full');
  });

  it('detects only valid stored values', () => {
    localStorage.setItem(HINT_LEVEL_STORAGE_KEY, 'concise');
    expect(detectHintLevel()).toBe('concise');
    localStorage.setItem(HINT_LEVEL_STORAGE_KEY, 'off');
    expect(detectHintLevel()).toBe('off');
  });

  it('persists the chosen level', () => {
    useEditorStore.getState().setHintLevel('concise');
    expect(useEditorStore.getState().hintLevel).toBe('concise');
    expect(localStorage.getItem(HINT_LEVEL_STORAGE_KEY)).toBe('concise');
  });
});

// The motion row above carries a 'Full' segment of its own, so every segment query is
// scoped to the hints row (found by its own label) rather than the whole modal.
function hintsRow(): HTMLElement {
  const row = screen.getByText('Quick hints').parentElement;
  if (!row) throw new Error('quick-hints row not found');
  return row;
}

describe('SettingsModal — quick-hints row', () => {
  it('renders the three levels with the current one pressed', () => {
    renderModal({ hintLevel: 'concise' });
    const row = within(hintsRow());
    expect(row.getByRole('button', { name: 'Concise' }).getAttribute('aria-pressed')).toBe('true');
    expect(row.getByRole('button', { name: 'Full' }).getAttribute('aria-pressed')).toBe('false');
    expect(row.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the clicked level to onHintLevelChange', () => {
    const onHintLevelChange = vi.fn();
    renderModal({ hintLevel: 'full', onHintLevelChange });
    fireEvent.click(within(hintsRow()).getByRole('button', { name: 'Concise' }));
    expect(onHintLevelChange).toHaveBeenCalledWith('concise');
  });

  it('sits directly after the motion row', () => {
    renderModal();
    const motionRow = screen.getByText('Motion').parentElement;
    expect(motionRow?.nextElementSibling).toBe(hintsRow());
  });
});
