// @vitest-environment jsdom
/**
 * A shell surface that throws while rendering stays inside its own slot. The bar is the case that
 * once blanked the whole page: its band stands in for it, the map, the mode row and the rail go on
 * working, a retry or another mode brings a bar back, and the console hears the failure once by name.
 * The windows host shows the notice instead, and the bar slot keeps working beside it.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { setStoreState } from '../../_support/store';

const broken = vi.hoisted(() => ({ toolbar: null as string | null, windows: false }));

vi.mock('../../../ui/shell/bars/EditToolbar', () => ({
  EditToolbar: ({ bar }: { bar: string }) => {
    if (broken.toolbar === bar) throw new Error(`the ${bar} toolbar broke`);
    return <div data-testid={`toolbar-${bar}`} />;
  },
}));

vi.mock('../../../ui/shell/edition-surfaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui/shell/edition-surfaces')>()),
  Windows: () => {
    if (broken.windows) throw new Error('the windows broke');
    return <div data-testid="windows" />;
  },
}));

const SURFACE_FAILED = translateFor('en', 'guard.surface_failed');
const RETRY = translateFor('en', 'guard.retry');

function mount() {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
      </I18nProvider>
    </MotionConfig>,
  );
}

const choose = (mode: 'mountain' | 'water' | null) => act(() => { useEditorStore.getState().setEditMode({ mode }); });

/** The lines this app writes about a failed surface, apart from React's own report. */
const surfaceReports = (spy: MockInstance<typeof console.error>) =>
  spy.mock.calls.filter(([first]) => typeof first === 'string' && first.includes('failed to render'));

// React in development rethrows a caught render error as a window event, which jsdom reports.
const swallow = (event: ErrorEvent) => event.preventDefault();
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  broken.toolbar = null;
  broken.windows = false;
  window.addEventListener('error', swallow);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setSelectingRegion(false);
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
});

afterEach(() => {
  window.removeEventListener('error', swallow);
  cleanup();
  vi.restoreAllMocks();
});

describe('a bar that throws', () => {
  it('stands the band in its slot while the map, the mode row and the rail stay', () => {
    broken.toolbar = 'mountain';
    mount();
    choose('mountain');
    const slot = screen.getByTestId('shell-mode-bar');
    const fallback = screen.getByTestId('bar-failed');
    expect(slot.contains(fallback), 'the fallback stands in the bar slot').toBe(true);
    expect(fallback.textContent).toContain(SURFACE_FAILED);
    expect(screen.getByTestId('map-views')).toBeTruthy();
    expect(screen.getByTestId('shell-rail-history')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Water' })).toBeTruthy();
    expect(screen.getByTestId('windows')).toBeTruthy();
  });

  it('comes back on retry once it renders again', () => {
    broken.toolbar = 'mountain';
    mount();
    choose('mountain');
    broken.toolbar = null;
    fireEvent.click(screen.getByTestId('bar-retry'));
    expect(screen.getByTestId('toolbar-mountain')).toBeTruthy();
    expect(screen.queryByTestId('bar-failed')).toBeNull();
  });

  it('gives way to the next bar when another mode is chosen', async () => {
    broken.toolbar = 'mountain';
    mount();
    choose('mountain');
    expect(screen.getByTestId('bar-failed')).toBeTruthy();
    // Both terrain bars share one slot node, so only the reset key can clear the failure.
    choose('water');
    await waitFor(() => expect(screen.getByTestId('toolbar-water')).toBeTruthy());
    expect(screen.queryByTestId('bar-failed')).toBeNull();
  });

  it('is reported once, by name', () => {
    broken.toolbar = 'mountain';
    mount();
    choose('mountain');
    const reports = surfaceReports(consoleError);
    expect(reports).toHaveLength(1);
    expect(String(reports[0]![0])).toContain('mountain bar');
  });
});

describe('a windows host that throws', () => {
  it('shows the notice and leaves the bar working', () => {
    broken.windows = true;
    mount();
    expect(screen.getByText(SURFACE_FAILED)).toBeTruthy();
    choose('water');
    expect(screen.getByTestId('toolbar-water')).toBeTruthy();
    broken.windows = false;
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(screen.getByTestId('windows')).toBeTruthy();
    expect(screen.queryByText(SURFACE_FAILED)).toBeNull();
  });
});
