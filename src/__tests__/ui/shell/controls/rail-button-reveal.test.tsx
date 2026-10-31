// @vitest-environment jsdom
/** A rail button's name opens when the button is reached for, which a finger does by holding it. */
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../../_support/spec';
import { I18nProvider } from '../../../../i18n/context';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { RailButton } from '../../../../ui/shell/controls/RailButton';
import { GESTURE_TIMING } from '../../../../platform/input/gesture-timing';
import type { InputMode } from '../../../../platform/device/input-mode';
import { focusLooksKeyboard } from '../../../_support/focus-visible';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });


function mount(inputMode: InputMode, onPress = vi.fn()) {
  const view = render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <InputModeProvider inputMode={inputMode}>
          <RailButton morph="undo" label="Undo" grow="left" onPress={onPress}><span /></RailButton>
        </InputModeProvider>
      </I18nProvider>
    </MotionConfig>,
  );
  return { button: view.getByRole('button', { name: 'Undo' }), onPress };
}

const nameOpen = (el: HTMLElement) => el.dataset.nameOpen === 'true';

spec('UI-29', 'in touch mode a long press reveals a rail button\'s name and a tap does not', () => {
  vi.useFakeTimers();
  const { button, onPress } = mount('touch');
  const hold = GESTURE_TIMING.touch.holdMs;

  fireEvent.pointerEnter(button, { pointerType: 'touch' });
  fireEvent.pointerDown(button, { pointerType: 'touch' });
  act(() => { vi.advanceTimersByTime(hold / 4); });
  fireEvent.pointerUp(button, { pointerType: 'touch' });
  fireEvent.click(button, { detail: 1 });
  act(() => { vi.advanceTimersByTime(hold); });
  expect(nameOpen(button)).toBe(false);
  expect(onPress).toHaveBeenCalledOnce();

  fireEvent.pointerDown(button, { pointerType: 'touch' });
  act(() => { vi.advanceTimersByTime(hold); });
  expect(nameOpen(button)).toBe(true);
  fireEvent.pointerUp(button, { pointerType: 'touch' });
  fireEvent.click(button, { detail: 1 });
  expect(nameOpen(button)).toBe(false);
  // The hold was a look at the name, so its release runs nothing.
  expect(onPress).toHaveBeenCalledOnce();
});

spec('UI-29', 'in PC mode a rail button\'s name opens on hover', () => {
  const { button } = mount('pc');
  fireEvent.pointerEnter(button, { pointerType: 'mouse' });
  expect(nameOpen(button)).toBe(true);
  fireEvent.pointerLeave(button, { pointerType: 'mouse' });
  expect(nameOpen(button)).toBe(false);
});

spec('UI-29', 'in PC mode a focus the keyboard did not make, such as a window regaining focus, opens no rail button name', () => {
  focusLooksKeyboard(false);
  const { button } = mount('pc');
  act(() => { button.focus(); });
  expect(nameOpen(button)).toBe(false);
  act(() => { button.blur(); });
  vi.restoreAllMocks();
  focusLooksKeyboard(true);
  act(() => { button.focus(); });
  expect(nameOpen(button)).toBe(true);
});
