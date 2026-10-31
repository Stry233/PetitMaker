// @vitest-environment jsdom
/**
 * The speech bubble that points out the object shelf's brush button the first time it stands
 * available, as a person meets it: the bottom bar and the shell's bubbles mounted together, the
 * bubble and the button found by their names and pressed.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { TOUR_OFFERED } from '../../_support/tour';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { ScaleProvider } from '../../../ui/design/scale';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { ModeBar } from '../../../ui/shell/controls/ModeBar';
import { MenuBubbles } from '../../../ui/chrome/floating/MenuBubbles';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { resetStore, setStoreModal, setStoreState } from '../../_support/store';
import { __resetArrivals } from '../../../ui/session/arrival-bus';
import { tourTargetAttr } from '../../../ui/chrome/tour/steps';
import type { InputMode } from '../../../platform/device/input-mode';

const en = (key: string): string => translations.en[key]!;
const s = () => useEditorStore.getState();
/** The task the bubbles wait through before they look. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

const PC_LINE = /press here and choose Paint/;
const TOUCH_LINE = /tap here and choose Paint/;

function mount(inputMode: InputMode = 'pc') {
  act(() => { s().setEditMode({ mode: 'object', arm: { kind: 'none' } }); });
  return render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode={inputMode} shape="landscape">
        <I18nProvider>
          <div {...tourTargetAttr('menu')} />
          <ScaleProvider value={0.5}>
            <ModeBar mode="object" surface={null} />
          </ScaleProvider>
          <MenuBubbles splashActive={false} />
        </I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
}

const bubble = () => screen.queryByTestId('speech-bubble');
const brushButton = () => screen.getByTestId('shell-shelf-brush');
const tab = (key: string) => screen.getByRole('tab', { name: en(key) });

beforeEach(() => {
  resetStore();
  __resetArrivals();
  localStorage.clear();
  localStorage.setItem(PREFS.tourSeen.key, TOUR_OFFERED);
  setStoreState({ locale: 'en', tourRunning: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the brush button\'s speech bubble', () => {
  spec('UI-57', 'hangs from the brush button once Objects shows a tab it can paint, and a press on the button opens the bar and puts it away for good', async () => {
    const view = mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(screen.getByRole('button', { name: PC_LINE })).toBeTruthy();
    fireEvent.pointerDown(brushButton());
    fireEvent.click(brushButton());
    expect(s().objectBrushBar, 'the press reaches the button under the bubble').toBe(true);
    await waitFor(() => expect(bubble()).toBeNull());
    view.unmount();
    act(() => { s().setObjectBrushBar(false); });
    mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(bubble(), 'seen once in this browser').toBeNull();
  });

  spec('UI-57', 'closed by its close, it never shows again', async () => {
    const view = mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    fireEvent.click(screen.getByRole('button', { name: en('hint.close') }));
    await waitFor(() => expect(bubble()).toBeNull());
    view.unmount();
    mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(bubble()).toBeNull();
  });

  spec('UI-57', 'pressing its words opens the brush bar', async () => {
    mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    fireEvent.click(screen.getByRole('button', { name: PC_LINE }));
    expect(s().objectBrushBar).toBe(true);
    expect(screen.getByTestId('shell-object-brush')).toBeTruthy();
  });

  spec('UI-57', 'waits while the button is unavailable, on a tab of items placed one at a time', async () => {
    mount();
    fireEvent.click(tab('shelf.tab_bridge'));
    await tick();
    expect(bubble()).toBeNull();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(bubble()).not.toBeNull();
  });

  spec('UI-57', 'never stands over a window or the welcome tips, and shows once they close', async () => {
    act(() => { setStoreModal('help', true); });
    mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(bubble()).toBeNull();
    act(() => { setStoreModal('help', false); setStoreState({ tourRunning: true }); });
    await tick();
    expect(bubble(), 'not over the tips or their Show me').toBeNull();
    act(() => { setStoreState({ tourRunning: false }); });
    await tick();
    // The tips ending owe the pointer to Help first; the brush bubble follows it.
    fireEvent.click(await screen.findByRole('button', { name: en('hint.close') }));
    expect(await screen.findByRole('button', { name: PC_LINE })).toBeTruthy();
  });

  spec('UI-57', 'reads tap in touch mode', async () => {
    mount('touch');
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(screen.getByRole('button', { name: TOUCH_LINE })).toBeTruthy();
  });

  spec('UI-57', 'never shows where the browser\'s storage cannot be read', async () => {
    const refuse = () => { throw new DOMException('denied', 'SecurityError'); };
    vi.stubGlobal('localStorage', {
      get length() { return refuse(); },
      getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse,
    });
    mount();
    fireEvent.click(tab('shelf.tab_flora'));
    await tick();
    expect(bubble()).toBeNull();
  });
});
