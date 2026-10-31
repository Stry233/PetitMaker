// @vitest-environment jsdom
/** A tool pill shows its glyph alone until it is armed, so it names itself as every glyph control does. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { setStoreState } from '../../../_support/store';
import { spec } from '../../../_support/spec';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { GESTURE_TIMING } from '../../../../platform/input/gesture-timing';
import { ToolPill } from '../../../../ui/shell/bars/ToolPill';
import { toolCell } from '../../../../ui/shell/bars/terrain-cells';

const mount = (mode: 'pc' | 'touch', onSelect = vi.fn()) => {
  setStoreState({ locale: 'en' });
  return render(<I18nProvider><InputModeProvider inputMode={mode}>
    <ToolPill glyph={toolCell('draw').glyph.mountain} label="Brush" commandId="tool.brush" active={false} centre={0} onSelect={onSelect}/>
  </InputModeProvider></I18nProvider>);
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ToolPill', () => {
  spec('UI-29', 'in touch mode a held unarmed tool pill shows its name, and the release arms nothing', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    mount('touch', onSelect);
    const pill = screen.getByRole('button', { name: 'Brush' });
    expect(pill.getAttribute('title')).toBeNull();
    fireEvent.pointerDown(pill, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(screen.getByText('Brush')).toBeTruthy();
    fireEvent.pointerUp(pill, { pointerType: 'touch' });
    fireEvent.click(pill, { detail: 1 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('names itself by a hover title with its shortcut in PC mode', () => {
    mount('pc');
    expect(screen.getByRole('button', { name: 'Brush' }).getAttribute('title')).toMatch(/^Brush/);
  });
});
