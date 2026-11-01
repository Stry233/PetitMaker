// @vitest-environment jsdom
/**
 * Each input mode's own interface scale, read and written through the store the frame zooms by and
 * the Settings scale slider that edits it.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { readPref, writePref } from '../../../platform/storage/prefs';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { SettingsModal } from '../../../ui/chrome/modals/settings/SettingsModal';
import { wipeLocalData } from '../../../io/storage/local-reset';
import type { Autosave } from '../../../io/storage/autosave';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { watchInputMode, type InputMode } from '../../../platform/device/input-mode';
import { TOUCH_TARGET, ArrangementRoomProvider, useChromeScale } from '../../../ui/design/scale';
import { useChromeLift } from '../../../ui/primitives/chrome-layer';
import { ARRANGEMENT_ROOM } from '../../../ui/shell/panel-frame';
import { useFrameZoom } from '../../../ui/shell/use-frame-zoom';
import { RailButton } from '../../../ui/shell/controls/RailButton';
import { RAIL } from '../../../ui/shell/units';

/** Switches the store to `mode` as the input detector does. */
function switchTo(mode: InputMode): void {
  act(() => { useEditorStore.getState().setInputMode(mode); });
}

function settings(mode: InputMode, shape: LayoutShape = 'portrait') {
  render(
    <InputModeProvider inputMode={mode} shape={shape}>
      <I18nProvider><SettingsModal open onClose={() => {}} /></I18nProvider>
    </InputModeProvider>,
  );
  return screen.getByRole('slider', { name: 'UI scale' });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  setStoreState({ locale: 'en', inputMode: 'pc', uiZoom: 1, layoutShape: 'portrait' });
});
afterEach(() => { cleanup(); resizeTo(1024, 768); });

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

/** An upright touch window under the providers the app root gives the interface. */
const upright = ({ children }: { children: ReactNode }) => (
  <InputModeProvider inputMode="touch" shape="portrait">
    <ArrangementRoomProvider value={ARRANGEMENT_ROOM}><I18nProvider>{children}</I18nProvider></ArrangementRoomProvider>
  </InputModeProvider>
);

/** A wide touch window under the same providers. */
const wide = ({ children }: { children: ReactNode }) => (
  <InputModeProvider inputMode="touch" shape="landscape">
    <ArrangementRoomProvider value={ARRANGEMENT_ROOM}><I18nProvider>{children}</I18nProvider></ArrangementRoomProvider>
  </InputModeProvider>
);

describe('the interface scale per input mode', () => {
  spec('UI-34', 'PC mode reads 100% and touch mode 125% on an upright screen by default', () => {
    expect(settings('pc').getAttribute('aria-valuenow')).toBe('100');
    cleanup();
    switchTo('touch');
    expect(useEditorStore.getState().uiZoom).toBe(1.25);
    expect(settings('touch').getAttribute('aria-valuenow')).toBe('125');
    switchTo('pc');
    expect(useEditorStore.getState().uiZoom, 'PC mode keeps its own scale').toBe(1);
  });

  spec('UI-34', 'the Settings scale control changes only the scale of the mode in force', () => {
    switchTo('touch');
    fireEvent.keyDown(settings('touch'), { key: 'Home' });
    expect(useEditorStore.getState().uiZoom).toBe(0.6);
    expect(readPref('touchUiZoom')).toBe(0.6);
    expect(readPref('uiZoom'), 'the PC scale is untouched').toBe(1);
    cleanup();
    switchTo('pc');
    expect(useEditorStore.getState().uiZoom).toBe(1);
    fireEvent.keyDown(settings('pc'), { key: 'ArrowRight' });
    expect(readPref('uiZoom')).toBe(1.05);
    expect(readPref('touchUiZoom'), 'the touch scale is untouched').toBe(0.6);
    switchTo('touch');
    expect(useEditorStore.getState().uiZoom, 'switching back brings the touch scale').toBe(0.6);
  });

  spec('UI-34', 'the touch slider runs from 60% in steps of 5% through 125%, which its reset restores', () => {
    switchTo('touch');
    const slider = settings('touch');
    expect(slider.getAttribute('aria-valuemin')).toBe('60');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useEditorStore.getState().uiZoom).toBe(1.3);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useEditorStore.getState().uiZoom).toBe(1.2);
    expect(screen.getByRole('button', { name: 'UI scale 125%' })).toBeTruthy();
  });

  spec('UI-34', 'a key on the slider that switches the editor to PC mode steps the PC scale from its own value', () => {
    switchTo('touch');
    const stop = watchInputMode((m) => useEditorStore.getState().setInputMode(m), 'touch');
    try {
      fireEvent.keyDown(settings('touch'), { key: 'ArrowRight' });
      expect(useEditorStore.getState().inputMode).toBe('pc');
      expect(readPref('uiZoom')).toBe(1.05);
      expect(readPref('touchUiZoom'), 'the touch scale is untouched').toBe(1.25);
    } finally {
      stop();
    }
  });

  spec('UI-34', 'a touch-only device starts in touch mode at the touch scale, a device with a mouse in PC mode', async () => {
    const boot = async (touchOnly: boolean) => {
      vi.resetModules();
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(any-pointer: fine)' ? !touchOnly : false, media: query }));
      vi.stubGlobal('navigator', { ...navigator, maxTouchPoints: touchOnly ? 5 : 0 });
      try {
        const { useEditorStore: fresh } = await import('../../../state/store');
        const { inputMode, uiZoom, layoutShape } = fresh.getState();
        return { inputMode, uiZoom: inputMode === 'touch' ? { [layoutShape]: uiZoom } : uiZoom };
      } finally {
        vi.unstubAllGlobals();
      }
    };
    writePref('uiZoom', 1.1);
    expect(await boot(true), 'the touch scale of the arrangement it starts in').toEqual({ inputMode: 'touch', uiZoom: { landscape: 1.05 } });
    expect(await boot(false)).toEqual({ inputMode: 'pc', uiZoom: 1.1 });
  });

  spec('UI-34', 'the reset chip restores the default of the mode in force', () => {
    switchTo('touch');
    act(() => { useEditorStore.getState().setUiZoom(0.8); });
    settings('touch');
    fireEvent.click(screen.getByRole('button', { name: 'UI scale 125%' }));
    expect(useEditorStore.getState().uiZoom).toBe(1.25);
    expect(readPref('touchUiZoom')).toBe(1.25);
  });

  spec('UI-34', 'resetting Local data restores every default', async () => {
    act(() => { useEditorStore.getState().setUiZoom(1.4); });
    switchTo('touch');
    act(() => { useEditorStore.getState().setUiZoom(0.7); });
    act(() => { useEditorStore.getState().setLayoutShape('landscape'); });
    act(() => { useEditorStore.getState().setUiZoom(0.9); });
    const autosave = { clear: () => {}, setSuspended: () => {} } as unknown as Autosave;
    await wipeLocalData(autosave);
    expect(readPref('uiZoom')).toBe(1);
    expect(readPref('touchUiZoom')).toBe(1.25);
    expect(readPref('touchWideUiZoom')).toBe(1.05);
  });

  spec('UI-34', 'touch mode keeps one scale upright and another wide, 105% wide by default, and turning the screen brings the other', () => {
    act(() => { useEditorStore.getState().setLayoutShape('landscape'); });
    switchTo('touch');
    expect(useEditorStore.getState().uiZoom).toBe(1.05);
    const slider = settings('touch', 'landscape');
    expect(slider.getAttribute('aria-valuenow')).toBe('105');
    expect(screen.getByRole('button', { name: 'UI scale 105%' }), 'the reset names the wide default').toBeTruthy();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(readPref('touchWideUiZoom')).toBe(1.1);
    expect(readPref('touchUiZoom'), 'the upright scale is untouched').toBe(1.25);
    act(() => { useEditorStore.getState().setLayoutShape('portrait'); });
    expect(useEditorStore.getState().uiZoom, 'upright brings its own').toBe(1.25);
    act(() => { useEditorStore.getState().setLayoutShape('landscape'); });
    expect(useEditorStore.getState().uiZoom, 'wide again brings the wide one back').toBe(1.1);
  });

  spec('UI-34', 'on an upright phone in touch mode the frame grows with the scale past its default, and the slider reaches it', () => {
    resizeTo(390, 844);
    switchTo('touch');
    const frame = renderHook(() => useFrameZoom(), { wrapper: upright });
    const atDefault = frame.result.current;
    act(() => { useEditorStore.getState().setUiZoom(1.45); });
    frame.rerender();
    expect(frame.result.current, 'a larger touch scale draws a larger frame').toBeGreaterThan(atDefault * 1.1);
    act(() => { useEditorStore.getState().setUiZoom(1.25); });
    render(<SettingsModal open onClose={() => {}} />, { wrapper: upright });
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    expect(Number(slider.getAttribute('aria-valuemax')), 'the track runs past the default').toBeGreaterThan(125);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(useEditorStore.getState().uiZoom).toBeGreaterThan(1.25);
  });

  spec('UI-34', 'on a phone in touch mode a scale under the default draws the frame smaller, upright and wide', () => {
    for (const [w, h, wrapper] of [[384, 832, upright], [832, 384, wide]] as const) {
      resizeTo(w, h);
      switchTo('touch');
      const frame = renderHook(() => useFrameZoom(), { wrapper });
      const atDefault = frame.result.current;
      act(() => { useEditorStore.getState().setUiZoom(1); });
      frame.rerender();
      expect(frame.result.current, `${w}x${h}`).toBeLessThan(atDefault / 1.1);
      cleanup();
      act(() => { useEditorStore.getState().setUiZoom(1.25); });
    }
  });

  spec('UI-34', 'on a phone in touch mode the frame, the chrome and a fingertip-sized window all follow the scale in one proportion, upright and wide', () => {
    // An S25 under Chrome's address bar, held both ways.
    for (const [w, h, wrapper] of [[384, 776, upright], [832, 328, wide]] as const) {
      resizeTo(w, h);
      switchTo('touch');
      const read = renderHook(() => ({ frame: useFrameZoom(), chrome: useChromeScale(), lift: useChromeLift(32).zoom }), { wrapper });
      const at = (z: number) => { act(() => { useEditorStore.getState().setUiZoom(z); }); read.rerender(); return { ...read.result.current }; };
      // Scales both arrangements hold: sideways under the address bar, her seat bounds it near 99%.
      const base = at(0.7);
      for (const z of [0.8, 0.9]) {
        const now = at(z);
        for (const k of ['frame', 'chrome', 'lift'] as const) expect(now[k] / base[k], `${w}x${h} ${k} at ${z}`).toBeCloseTo(z / 0.7, 6);
      }
      cleanup();
      act(() => { useEditorStore.getState().setUiZoom(1.25); });
    }
  });

  spec('UI-34', 'on a phone in touch mode the windows and notices keep one proportion to the frame held upright or wide', () => {
    // At the touch default the sideways frame stands under the upright size, held by the phone's height.
    const ratioAt = (w: number, h: number, wrapper: typeof upright) => {
      resizeTo(w, h);
      switchTo('touch');
      act(() => { useEditorStore.getState().setUiZoom(1.25); });
      const read = renderHook(() => ({ frame: useFrameZoom(), lift: useChromeLift(32).zoom }), { wrapper }).result.current;
      cleanup();
      return read.lift / read.frame;
    };
    expect(ratioAt(832, 328, wide)).toBeCloseTo(ratioAt(384, 776, upright), 6);
  });

  spec('UI-34', 'on a phone in touch mode one scale draws the frame at one size held upright or wide', () => {
    const frameAt = (w: number, h: number, wrapper: typeof upright) => {
      resizeTo(w, h);
      switchTo('touch');
      act(() => { useEditorStore.getState().setUiZoom(0.9); });
      const zoom = renderHook(() => useFrameZoom(), { wrapper }).result.current;
      cleanup();
      return zoom;
    };
    expect(frameAt(832, 328, wide)).toBeCloseTo(frameAt(384, 776, upright), 9);
  });

  spec('UI-34', 'in PC mode an upright tablet-sized window draws the chrome at the size a wide window of room does', () => {
    const chromeAt = (w: number, h: number, shape: LayoutShape) => {
      resizeTo(w, h);
      const pc = ({ children }: { children: ReactNode }) => <InputModeProvider inputMode="pc" shape={shape}><I18nProvider>{children}</I18nProvider></InputModeProvider>;
      const scale = renderHook(() => useChromeScale(), { wrapper: pc }).result.current;
      cleanup();
      return scale;
    };
    expect(chromeAt(1280, 800, 'landscape')).toBe(1);
    expect(chromeAt(820, 1180, 'portrait')).toBe(chromeAt(1280, 800, 'landscape'));
  });

  spec('UI-34', 'at the touch default an upright phone draws its rail buttons under a fingertip\'s size, each still answering a 44 px fingertip', () => {
    resizeTo(384, 832);
    switchTo('touch');
    const zoom = renderHook(() => useFrameZoom(), { wrapper: upright }).result.current;
    expect(RAIL.button * zoom, 'the drawing is smaller than the hit area').toBeLessThan(TOUCH_TARGET);
    render(<RailButton morph="probe" label="Undo" grow="left" onPress={() => {}}>{null}</RailButton>, { wrapper: upright });
    const reach = screen.getByRole('button', { name: 'Undo' }).querySelector<HTMLElement>('[data-touch-reach]')!;
    const span = (from: 'top' | 'left', to: 'bottom' | 'right') =>
      (RAIL.button - (parseFloat(reach.style[from]) || 0) - (parseFloat(reach.style[to]) || 0)) * zoom;
    expect(span('left', 'right')).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-9);
    expect(span('top', 'bottom')).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-9);
  });
});
