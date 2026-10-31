// @vitest-environment jsdom
/** The studio footer's gear names itself to a finger as its hover title names it to a mouse. */
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../../../../_support/spec';
import { IconVerb } from '../../../../../../ui/chrome/modals/export/stylize/stylize-parts';
import { InputModeProvider } from '../../../../../../ui/design/input-mode';
import { GESTURE_TIMING } from '../../../../../../platform/input/gesture-timing';
import type { InputMode } from '../../../../../../platform/device/input-mode';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const mount = (inputMode: InputMode, onClick = vi.fn()) => {
  render(
    <MotionConfig reducedMotion="always"><InputModeProvider inputMode={inputMode}>
      <IconVerb label="Connection" onClick={onClick}><span /></IconVerb>
    </InputModeProvider></MotionConfig>,
  );
  return screen.getByRole('button', { name: 'Connection' });
};

spec('UI-29', 'in touch mode a held studio gear shows its name and its release presses nothing', () => {
  vi.useFakeTimers();
  const onClick = vi.fn();
  const gear = mount('touch', onClick);
  expect(gear.getAttribute('title')).toBeNull();
  fireEvent.pointerDown(gear, { pointerType: 'touch' });
  act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
  expect(screen.getByText('Connection')).toBeTruthy();
  fireEvent.pointerUp(gear, { pointerType: 'touch' });
  fireEvent.click(gear, { detail: 1 });
  expect(onClick).not.toHaveBeenCalled();
});

spec('UI-29', 'in PC mode the studio gear keeps its hover title', () => {
  expect(mount('pc').getAttribute('title')).toBe('Connection');
});
