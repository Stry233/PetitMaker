// @vitest-environment jsdom
/**
 * The dreaming board: the board's outer height is fixed to the tallest trio its rotation can show,
 * measured off a hidden ruler.
 * The reserved height is the tallest window of three consecutive orders in the cycle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { DreamOffice, DREAMS } from '../../../ui/agent/desk/DreamOffice';
import { translations } from '../../_support/locale-tables';

/** Mounted inside `act`, because the board's own rAF loop commits a beat on the first frame. */
function mount(pinned = false): { container: HTMLElement } {
  let out!: { container: HTMLElement };
  act(() => { out = render(<I18nProvider><DreamOffice onConnect={() => {}} pinned={pinned} /></I18nProvider>); });
  return out;
}

describe('every slip carries its own built picture', () => {
  it('renders a thumbnail image on each visible row, never an empty box', () => {
    const { container } = mount();
    const thumbs = container.querySelectorAll('[data-testid="dream-thumb"]');
    expect(thumbs.length).toBeGreaterThan(0);
    for (const img of thumbs) {
      expect((img as HTMLImageElement).getAttribute('src'), 'thumb src').toBeTruthy();
    }
  });
});

describe('the dreaming board reserves one height', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Docked, the zone is the window's height, so the whole pool stands with no rotation or reserve. */
  describe('docked, the board stands the whole pool', () => {
    it('shows every order in the pool, standing', () => {
      const { container } = mount(true);
      expect(container.querySelectorAll('[data-testid="dream-row"]')).toHaveLength(DREAMS.length);
    });

    it('turns nothing over: the standing pool has nothing left to reveal', () => {
      const { container } = mount(true);
      const order = () => [...container.querySelectorAll('[data-testid="dream-row"]')]
        .map((r) => r.getAttribute('data-order'));
      const first = order();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(order()).toEqual(first);
      expect(container.querySelector('[data-testid="dream-row-leaving"]')).toBeNull();
    });
  });

  /** A wrapping title or sub line grows the reserve, so the three longest lines stay under the counts
   *  where they wrap in the live panel (1280x800 at the frame's 1.25 zoom). */
  it('keeps the pool\'s known-tall lines short enough not to wrap, in en and in ru', () => {
    const village = DREAMS.find((o) => o.id === 'village')!;
    const forest = DREAMS.find((o) => o.id === 'forest')!;
    const road = DREAMS.find((o) => o.id === 'road')!;
    // Measured fit boundaries at the panel's column width: the bolder, larger title font and
    // Cyrillic both wrap sooner.
    const titleCap: Record<'en' | 'ru', number> = { en: 34, ru: 28 };
    const subCap: Record<'en' | 'ru', number> = { en: 37, ru: 33 };
    for (const locale of ['en', 'ru'] as const) {
      expect(translations[locale][village.subKey]!.length, `${locale} village sub`).toBeLessThanOrEqual(subCap[locale]);
      expect(translations[locale][forest.subKey]!.length, `${locale} forest sub`).toBeLessThanOrEqual(subCap[locale]);
      expect(translations[locale][road.titleKey]!.length, `${locale} road title`).toBeLessThanOrEqual(titleCap[locale]);
    }
  });
});

describe('the keyless office points at Help', () => {
  it('opens the setup page at its key steps from Learn more', () => {
    useEditorStore.getState().setHelpTarget(null);
    const { container } = mount();
    fireEvent.click(within(container).getByRole('button', { name: translations.en['agent.learn_more'] }));
    expect(useEditorStore.getState().helpTarget).toEqual({ page: 'agent-setup', anchor: 'agsetup-keys' });
    expect(useEditorStore.getState().modals.help).toBe(true);
  });
});
