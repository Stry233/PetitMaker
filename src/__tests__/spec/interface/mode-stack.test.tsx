// @vitest-environment jsdom
/**
 * A top row too narrow for the whole mode row beside the corner actions: the modes fold into one stack
 * that unfolds in place, rendered through the frame's own plan.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { FrameLayoutProvider } from '../../../ui/shell/frame-layout';
import { ModeRow, type ChromeSwap } from '../../../ui/shell/controls/ModeRow';
import { MODES } from '../../../ui/shell/frame';
import { useEditorStore } from '../../../state/store';

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

const wide = ({ children }: { children: ReactNode }) => (
  <InputModeProvider inputMode="pc" shape="landscape"><I18nProvider><FrameLayoutProvider>{children}</FrameLayoutProvider></I18nProvider></InputModeProvider>
);

beforeEach(() => { resetStore(); setStoreState({ locale: 'en', inputMode: 'pc', layoutShape: 'landscape', uiZoom: 1.8, modeRowOpen: false }); });
afterEach(() => { cleanup(); resizeTo(1024, 768); });

/** The mode buttons a reader can reach: a folded stack keeps those behind its front inert. */
const reachable = () => screen.getAllByRole('button').filter((b) => !b.closest('[inert]')).map((b) => b.getAttribute('aria-label'));

describe('the folded mode row', () => {
  spec('UI-34', 'folds the modes into one stack in their own order, unfolds it in place, and picking a mode folds it again', () => {
    resizeTo(700, 600);
    const onPick = vi.fn();
    render(<ModeRow modes={MODES} mode="mountain" swap={{} as ChromeSwap} onPick={onPick} />, { wrapper: wide });
    expect(reachable(), 'one stack, named for what pressing it does').toEqual(['Show modes']);
    expect(screen.getByRole('group', { name: 'Modes' }), 'in the group of modes').toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show modes' }).hasAttribute('aria-expanded'), 'an action, not a state it never leaves').toBe(false);
    const order = [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(order, 'the row\'s own order, the first in front').toEqual(['Show modes', 'Roads', 'Mountains', 'Water', 'Generate']);
    expect(screen.queryByText('Mountains'), 'the stack shows its tiles without words').toBeNull();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show modes' })); });
    expect(useEditorStore.getState().modeRowOpen).toBe(true);
    expect(reachable(), 'unfolded in place, in the same order').toEqual(['Objects', 'Roads', 'Mountains', 'Water', 'Generate']);
    expect(screen.getByText('Mountains'), 'unfolded, the open mode is named under its tile').toBeTruthy();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Water' })); });
    expect(onPick).toHaveBeenCalledWith('water');
    expect(useEditorStore.getState().modeRowOpen, 'picking folds it').toBe(false);
  });

  spec('UI-34', 'folds back on Escape', () => {
    resizeTo(700, 600);
    render(<ModeRow modes={MODES} mode={null} swap={{} as ChromeSwap} onPick={() => {}} />, { wrapper: wide });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show modes' })); });
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(useEditorStore.getState().modeRowOpen).toBe(false);
  });

  spec('UI-34', 'carries the same tiles into the stack and out again as the window narrows and widens across the fold', () => {
    resizeTo(1280, 600);
    act(() => { useEditorStore.getState().setUiZoom(1); });
    render(<ModeRow modes={MODES} mode="mountain" swap={{} as ChromeSwap} onPick={() => {}} />, { wrapper: wide });
    const tiles = () => [...document.querySelectorAll('button')];
    const row = tiles();
    expect(reachable()).toEqual(['Objects', 'Roads', 'Mountains', 'Water', 'Generate']);
    act(() => { useEditorStore.getState().setUiZoom(1.8); resizeTo(700, 600); });
    expect(reachable(), 'folded').toEqual(['Show modes']);
    expect(tiles(), 'each tile travels into the stack rather than being replaced by another').toEqual(row);
    act(() => { useEditorStore.getState().setUiZoom(1); resizeTo(1280, 600); });
    expect(reachable(), 'unfolded by the wider window').toEqual(['Objects', 'Roads', 'Mountains', 'Water', 'Generate']);
    expect(tiles(), 'and out of it again').toEqual(row);
    expect(useEditorStore.getState().modeRowOpen, 'a row the window holds whole is not left open').toBe(false);
  });

  spec('UI-34', 'keeps the open first mode\'s drawing on the stack\'s front as the row folds, only its words leaving', () => {
    resizeTo(1280, 600);
    act(() => { useEditorStore.getState().setUiZoom(1); });
    render(<ModeRow modes={MODES} mode="object" swap={{} as ChromeSwap} onPick={() => {}} />, { wrapper: wide });
    const drawing = () => document.querySelector('button img')!.getAttribute('src');
    const open = drawing();
    act(() => { useEditorStore.getState().setUiZoom(1.8); resizeTo(700, 600); });
    expect(reachable()).toEqual(['Show modes']);
    expect(drawing(), 'the same drawing through the fold').toBe(open);
  });

  spec('UI-34', 'keeps the whole row wherever the top row holds it beside the corner actions', () => {
    resizeTo(700, 600);
    act(() => { useEditorStore.getState().setUiZoom(1); });
    render(<ModeRow modes={MODES} mode={null} swap={{} as ChromeSwap} onPick={() => {}} />, { wrapper: wide });
    expect(screen.getByRole('button', { name: 'Roads' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show modes' })).toBeNull();
  });

  spec('UI-34', 'stands folded again after a turn to upright and back, never reopening by itself', () => {
    resizeTo(700, 600);
    const at = (shape: 'landscape' | 'portrait') => (
      <InputModeProvider inputMode="pc" shape={shape}><I18nProvider><FrameLayoutProvider>
        <ModeRow modes={MODES} mode={null} swap={{} as ChromeSwap} onPick={() => {}} />
      </FrameLayoutProvider></I18nProvider></InputModeProvider>
    );
    const view = render(at('landscape'));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show modes' })); });
    expect(reachable()).toEqual(['Objects', 'Roads', 'Mountains', 'Water', 'Generate']);
    act(() => { resizeTo(600, 900); view.rerender(at('portrait')); });
    expect(useEditorStore.getState().modeRowOpen, 'the upright row holds every mode, so nothing stands unfolded').toBe(false);
    act(() => { resizeTo(700, 600); view.rerender(at('landscape')); });
    expect(reachable(), 'folded, as a wide window this narrow stands').toEqual(['Show modes']);
  });

  spec('UI-34', 'names only the new mode under the unfolded row when the mode switches, as the upright row does', async () => {
    resizeTo(1280, 600);
    act(() => { useEditorStore.getState().setUiZoom(1); });
    const view = render(<ModeRow modes={MODES} mode="mountain" swap={{} as ChromeSwap} onPick={() => {}} />, { wrapper: wide });
    expect(screen.getByText('Mountains')).toBeTruthy();
    view.rerender(<ModeRow modes={MODES} mode="water" swap={{} as ChromeSwap} onPick={() => {}} />);
    await act(async () => { await new Promise((r) => { setTimeout(r, 60); }); });
    expect(screen.queryByText('Mountains'), 'the old name leaves at once rather than fading beside the new').toBeNull();
    expect(screen.getByText('Water')).toBeTruthy();
  });
});
