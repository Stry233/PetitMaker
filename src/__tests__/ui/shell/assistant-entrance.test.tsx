/**
 * The assistant's SEAT, and the two facts her placement depends on.
 *
 * The character is ONE element in ONE seat, open or shut: the seat is measured with
 * `getBoundingClientRect` and she positions herself `fixed` from those numbers
 * (`ui/agent/character/seat.ts`), while the frame anchors the panel's own top-left corner to the same
 * box. That makes two properties of the real tree load-bearing, and neither is visible from the
 * components in isolation:
 *
 *  - no ancestor of the seat may carry a `transform` or a `filter`, since either becomes the
 *    containing block for the `fixed` element that stands there (and the offset parent her dust puff
 *    is placed against);
 *  - the character's own layer must stand OUTSIDE the frame's `zoom`, because a fixed element inside
 *    a zoomed subtree resolves its own coordinates in zoomed space while a measured rect is in the
 *    window's, so a character placed from a measurement inside the zoom lands at zoom times its own
 *    position. The same argument `narrow-viewport.test.tsx` makes for the viewport vignette.
 *
 * jsdom lays nothing out, so what is asserted is the DECISIONS: which elements exist, what they
 * carry, and the arithmetic behind the column's width.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { PANEL_WIDTH } from '../../../ui/agent/tokens';
import { PANEL_COLUMN_W, PANEL_LEFT } from '../../../ui/shell/panel-frame';
import { MODES, MODE_PLATE, MODE_PLATE_ID } from '../../../ui/shell/frame';
import { EDGE_LEFT, MODE } from '../../../ui/shell/units';
import { Shell } from '../../../ui/shell/Shell';
import { UiPreviewProvider } from '../../../ui/primitives/ui-preview';
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

/** The panel is a lazy chunk: here `import()` compiles the assistant graph instead of fetching a
 *  built one (0.6s or more, against the 1s an async query allows), and React's `lazy` suspends on
 *  its first render regardless. Both are paid by opening it once, before anything below is timed —
 *  `narrow-viewport.test.tsx` states the argument at greater length. */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, '1');
  useEditorStore.setState({ locale: 'en', assistantOpen: true });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
});

beforeEach(() => {
  backing.clear();
  backing.set(TOUR_SEEN_KEY, '1'); // a returning visitor: the tour is not the subject
  useEditorStore.setState({ locale: 'en', assistantOpen: false });
  useEditorStore.getState().setEditMode({ mode: null });
});
afterEach(cleanup);

describe('the panel column', () => {
  /** The panel's width IS the mode row's: the column lines up with the row above it at both edges,
   *  so the arithmetic lives here and `ui/agent/tokens.ts:PANEL_WIDTH` re-exports it rather than
   *  standing a second constant beside it. */
  it('is exactly as wide as the row of mode blocks', () => {
    expect(PANEL_COLUMN_W).toBe(MODES.length * MODE.size + (MODES.length - 1) * MODE.gap);
    expect(PANEL_COLUMN_W).toBe(PANEL_WIDTH);
  });

  it('stands on the same left margin as the blocks above it', () => {
    expect(PANEL_LEFT).toBe(EDGE_LEFT);
  });
});

describe("the character's entrance", () => {
  it('is a box in the assistant block, and the block draws no picture of its own there', () => {
    mountShell();
    const anchor = screen.getByTestId('entrance-plate-anchor');
    expect(anchor.querySelector('img')).toBeNull();
  });

  /**
   * IT WEARS NO ARMED DRESS, which is the one way this block is not a mode block.
   *
   * A mode block's yellow splat says what the map is armed with, a fact nothing else on screen
   * carries. The panel says its own by standing where this box is, three hundred px of it, with the
   * character at its top-left corner — so a splat here has nothing to add, and it does not even stay
   * hidden: the panel is narrower than the splat is wide, so a wing of the mode row's
   * selected yellow stands out from under the panel's top corner for as long as the panel is open,
   * reading as a sixth mode nobody chose.
   *
   * The mode row's own splat is untouched, and this is the assertion that keeps the two apart: with
   * no mode armed there is no splat on screen at all, and with one armed the single splat belongs to
   * the ROW rather than to the block that opens the panel.
   */
  it('wears no selected splat while the panel is open', async () => {
    mountShell();
    /** Every splat drawing on screen, found by its ART rather than by a test id: a stray copy
     *  carrying no test id would escape any id-based query. */
    const splats = () => [...document.querySelectorAll('img')]
      .filter((img) => img.getAttribute('src') === MODE_PLATE.src);
    /** The assistant block's own box: the anchor's nearest positioned container. */
    const block = () => screen.getByTestId('entrance-plate-anchor').closest('button')!.parentElement!;

    fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
    await screen.findByTestId('shell-assistant-panel');
    expect(splats().filter((img) => block().contains(img))).toHaveLength(0);

    // The mode ROW's splat is untouched, and still belongs to the row rather than to this block.
    act(() => { useEditorStore.getState().setEditMode({ mode: 'object' }); });
    expect(document.querySelectorAll(`[data-testid="${MODE_PLATE_ID}"]`)).toHaveLength(1);
    expect(splats().filter((img) => block().contains(img))).toHaveLength(0);
  });

  it('carries no transform or filter on any ancestor of it', () => {
    mountShell();
    for (let el: HTMLElement | null = screen.getByTestId('entrance-plate-anchor'); el && el !== document.body; el = el.parentElement) {
      expect(el.style.transform, el.getAttribute('data-testid') ?? el.tagName).toBe('');
      expect(el.style.filter, el.getAttribute('data-testid') ?? el.tagName).toBe('');
    }
  });

  it('stands the character in a layer outside the frame\'s zoom', () => {
    mountShell();
    const layer = screen.getByTestId('character-layer');
    for (let el = layer.parentElement; el; el = el.parentElement) {
      expect(el.getAttribute('style') ?? '').not.toContain('zoom');
    }
    // And DEAF as a layer: the two things in it that take a press (the character herself, and the
    // chip at her shoulder) turn it on for their own boxes, so nothing covers the window.
    expect(layer.style.pointerEvents).toBe('none');
  });

  /** ONE CHARACTER, app-wide, and the whole design rests on it: with the panel open the
   *  desk RESERVES her box rather than drawing a second copy of her further down the screen. */
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
    expect(screen.getByTestId('character-layer').style.visibility).toBe('visible');
    act(() => { fireEvent.click(screen.getByLabelText(translate('a11y.hide_ui'))); });
    expect(screen.getByTestId('character-layer').style.visibility).toBe('hidden');
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
    // The lazy chunk is warm, so a panel the picture mounted would stand within a few frames.
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.queryByTestId('shell-assistant-panel')).toBeNull();
    expect(deskSeat()).toBeNull();
  });
});
