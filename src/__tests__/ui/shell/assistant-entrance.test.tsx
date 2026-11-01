// @vitest-environment jsdom
/**
 * The assistant's character on the shell: one copy on screen with the panel open or shut, no selected
 * splat on her block, and gone with the frame when the interface is put away. Where she stands is
 * checked in a browser.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { MODE_PLATE, MODE_PLATE_ID } from '../../../ui/shell/frame';
import { Shell } from '../../../ui/shell/Shell';
import { UiPreviewProvider } from '../../../ui/design/preview';
import { deskSeat } from '../../../ui/agent/character/seat';

const backing = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  },
});

function mountShell() {
  return render(
    <I18nProvider>
      <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
    </I18nProvider>,
  );
}

/** The panel is a lazy chunk that compiles here in 0.6s or more, against the 1s an async query
 *  allows, so it is opened once before anything below is timed. */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, TOUR_OFFERED);
  useEditorStore.setState({ locale: 'en', assistantOpen: true });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
});

beforeEach(() => {
  backing.clear();
  backing.set(TOUR_SEEN_KEY, TOUR_OFFERED); // a returning visitor, so no tour
  useEditorStore.setState({ locale: 'en', assistantOpen: false });
  useEditorStore.getState().setEditMode({ mode: null });
});
afterEach(cleanup);

describe("the character's entrance", () => {
  /** The panel is narrower than the splat, so a splat on this block would show from under its corner
   *  as a sixth mode. */
  it('wears no selected splat while the panel is open', async () => {
    mountShell();
    /** Found by its art, since a stray copy with no test id would escape an id query. */
    const splats = () => [...document.querySelectorAll('img')]
      .filter((img) => img.getAttribute('src') === MODE_PLATE.src);
    /** The assistant block's own box: the anchor's nearest positioned container. */
    const block = () => screen.getByTestId('entrance-plate-anchor').closest('button')!.parentElement!;

    fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
    await screen.findByTestId('shell-assistant-panel');
    expect(splats().filter((img) => block().contains(img))).toHaveLength(0);

    act(() => { useEditorStore.getState().setEditMode({ mode: 'object' }); });
    expect(document.querySelectorAll(`[data-testid="${MODE_PLATE_ID}"]`)).toHaveLength(1);
    expect(splats().filter((img) => block().contains(img))).toHaveLength(0);
  });

  /** With the panel open the desk reserves her box rather than drawing a second copy. */
  it('is the only character on screen, panel open or shut', async () => {
    mountShell();
    expect(document.querySelectorAll('[data-testid="pw-character"]')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
    await screen.findByTestId('shell-assistant-panel');
    expect(document.querySelectorAll('[data-testid="pw-character"]')).toHaveLength(1);
    expect(screen.getByTestId('desk-header-char-slot').querySelector('[data-testid="pw-character"]')).toBeNull();
  });

  it('goes away with the frame when the interface is put away', () => {
    mountShell();
    const shown = () => getComputedStyle(screen.getByTestId('character-layer')).visibility !== 'hidden';
    expect(shown()).toBe(true);
    act(() => { fireEvent.click(screen.getByLabelText(translate('a11y.hide_ui'))); });
    expect(shown()).toBe(false);
  });
});

describe('a pictured shell', () => {
  it('mounts no assistant panel while the live one stands open, so the character keeps her live seat', async () => {
    useEditorStore.setState({ assistantOpen: true });
    render(
      <I18nProvider>
        <UiPreviewProvider pose={{ viewport: { w: 1280, h: 720 } }}>
          <Shell onRestoreSession={() => {}}>{null}</Shell>
        </UiPreviewProvider>
      </I18nProvider>,
    );
    // The chunk is warm, so a panel the picture mounted would stand within a few frames.
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.queryByTestId('shell-assistant-panel')).toBeNull();
    expect(deskSeat()).toBeNull();
  });
});
