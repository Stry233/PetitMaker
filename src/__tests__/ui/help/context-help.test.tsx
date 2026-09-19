import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContextHelp } from '../../../ui/chrome/modals/help/use-context-help';
import { helpTargetAt } from '../../../ui/chrome/modals/help/targets';
import { inheritedHelpTarget } from '../../../ui/primitives/help-target';
import { COMMAND_META, effectiveCombo, PRESETS, presetBinds, useKeybinds } from '../../../core/runtime/keybindings';
import { KEY_ROWS, comboFor } from '../../../ui/chrome/modals/keyboard/layout';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_store';

function Harness() {
  useContextHelp();
  return <div data-help="share" data-help-anchor="share-header"><input aria-label="Title" defaultValue="My island" /></div>;
}
const helpKey = () => fireEvent.keyDown(document.activeElement ?? window, { key: 'H', code: 'KeyH', shiftKey: true });
beforeEach(() => {
  useKeybinds.getState().resetAll();
  setStoreState({ whatsThis: false, helpTarget: null, tourRunning: false, portraitBlocked: false,
    modals: { ...useEditorStore.getState().modals, help: false, settings: true } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useKeybinds.getState().resetAll(); });

describe('context help shortcut', () => {
  it('has a distinct default and appears on the Shift layer', () => {
    expect(COMMAND_META.filter(c => c.defaultCombo === 'shift+h').map(c => c.id)).toEqual(['app.whats_this']);
    for (const preset of PRESETS) {
      expect([...presetBinds(preset)].filter(([, combo]) => combo === 'shift+h').map(([id]) => id)).toEqual(['app.whats_this']);
    }
    const key = KEY_ROWS.flat().find(k => k.base === 'h')!;
    expect(comboFor(key, { ctrl: false, alt: false, shift: false })).toBe('h');
    expect(comboFor(key, { ctrl: false, alt: false, shift: true })).toBe('shift+h');
  });
  it('explains a focused field without changing its draft', () => {
    render(<Harness />);
    helpKey();
    const input = screen.getByRole('textbox'); input.focus();
    expect(useEditorStore.getState().whatsThis).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useEditorStore.getState().helpTarget).toEqual({ page: 'share', anchor: 'share-header' });
    expect(useEditorStore.getState().modals).toMatchObject({ help: true, settings: true });
    expect((input as HTMLInputElement).value).toBe('My island');
  });
  it('cancels only the picker and stops other keyboard handlers', () => {
    render(<Harness />);
    const dismiss = vi.fn(); window.addEventListener('keydown', dismiss);
    helpKey();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismiss).not.toHaveBeenCalled();
    expect(useEditorStore.getState().whatsThis).toBe(false);
    expect(useEditorStore.getState().modals.settings).toBe(true);
    window.removeEventListener('keydown', dismiss);
  });
  it('does not toggle repeatedly while held, and the shortcut toggles off', () => {
    render(<Harness />); helpKey();
    fireEvent.keyDown(window, { key: 'H', shiftKey: true, repeat: true });
    expect(useEditorStore.getState().whatsThis).toBe(true);
    helpKey(); expect(useEditorStore.getState().whatsThis).toBe(false);
  });
  it('honors rebinding, clearing and collisions with an existing custom binding', () => {
    render(<Harness />);
    act(() => { useKeybinds.getState().rebind('app.whats_this', 'ctrl+alt+h'); });
    helpKey(); expect(useEditorStore.getState().whatsThis).toBe(false);
    const input = screen.getByRole('textbox'); input.focus();
    fireEvent.keyDown(input, { key: 'h', ctrlKey: true, altKey: true });
    expect(useEditorStore.getState().whatsThis).toBe(true);
    act(() => { useEditorStore.getState().setWhatsThis(false); useKeybinds.getState().clear('app.whats_this'); });
    helpKey(); expect(useEditorStore.getState().whatsThis).toBe(false);
    act(() => { useKeybinds.getState().resetAll(); useKeybinds.getState().rebind('app.help', 'shift+h'); });
    expect(effectiveCombo(useKeybinds.getState().overrides, 'app.whats_this')).toBeNull();
    helpKey(); expect(useEditorStore.getState().whatsThis).toBe(false);
  });
  it('leaves shortcut recording and text entry alone', () => {
    const { container } = render(<Harness />);
    container.setAttribute('data-shortcut-recording', 'true');
    helpKey(); expect(useEditorStore.getState().whatsThis).toBe(false);
    container.removeAttribute('data-shortcut-recording');
    const input = screen.getByRole('textbox'); input.focus();
    expect(fireEvent.keyDown(input, { key: 'H', code: 'KeyH', shiftKey: true })).toBe(true);
    expect(useEditorStore.getState().whatsThis).toBe(false);
  });
  it('blocks outside-dismiss pointer listeners during inspection', () => {
    render(<Harness />); helpKey();
    const dismiss = vi.fn(); window.addEventListener('pointerdown', dismiss, true);
    fireEvent.pointerDown(document.body);
    expect(dismiss).not.toHaveBeenCalled();
    window.removeEventListener('pointerdown', dismiss, true);
  });
});

describe('foreground help targets', () => {
  it('uses the nearest section, including a disabled control', () => {
    const { container } = render(<div data-help="settings"><div data-help="share" data-help-anchor="share-header"><button disabled>Title</button></div></div>);
    const button = screen.getByRole('button');
    const layer = document.createElement('div');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [layer, button, container] });
    expect(helpTargetAt(1, 1, layer)).toMatchObject({ page: 'share', anchor: 'share-header' });
    expect(inheritedHelpTarget(button)).toEqual({ page: 'share', anchor: 'share-header' });
  });
  it('never looks through an unmarked foreground panel', () => {
    const layer = document.createElement('div');
    const panel = document.createElement('div');
    const behind = document.createElement('div'); behind.setAttribute('data-help', 'terrain');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [layer, panel, behind] });
    expect(helpTargetAt(1, 1, layer)).toBeNull();
  });
});

describe('portaled help targets', () => {
  it('retains the trigger topic outside its DOM ancestry', async () => {
    const { FloatMenu } = await import('../../../ui/primitives/FloatMenu');
    const { I18nProvider } = await import('../../../i18n/context');
    const view = (open: boolean) => <I18nProvider><div data-help="share" data-help-anchor="share-preset">
      <FloatMenu row="Preset" open={open} onOpen={() => {}} onClose={() => {}} items={[{ id: 'original', label: 'Original' }]} />
    </div></I18nProvider>;
    const { rerender } = render(view(false)); rerender(view(true));
    expect(inheritedHelpTarget(screen.getByRole('menuitemradio'))).toEqual({ page: 'share', anchor: 'share-preset' });
  });
});
