// @vitest-environment jsdom
/** Shift with a cycle's key steps its group of options back: the keys, the styles, and where it is told. */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { useKeybinds } from '../../../state/keymap/store';
import { PRESETS } from '../../../state/keymap/registry';
import { reverseCombos } from '../../../state/keymap/resolve';
import { useEditorStore } from '../../../state/store';
import { buildShapeOf } from '../../../state/editing/edit-mode';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { HelpModal } from '../../../ui/help/HelpModal';
import { KeyboardModal } from '../../../ui/chrome/modals/keyboard/KeyboardModal';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { useEditorShortcuts } from '../../../ui/shell/use-editor-shortcuts';

function Keys() {
  useEditorShortcuts({ toggleMenu: () => {} });
  return null;
}
const state = () => useEditorStore.getState();
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init });
const shifted = (key: string, code?: string) => press(key, { shiftKey: true, code });
const style = (id: string) => { act(() => { useKeybinds.getState().applyBinds(PRESETS.find((p) => p.id === id)!.binds); }); };
const LINE = translateFor('en', 'kbd.reverse_hint');

beforeEach(() => {
  useKeybinds.getState().resetAll();
  useEditorStore.setState({ locale: 'en', selectingRegion: false, autoEdgeCut: 'off', terrainThickness: 1, planetSession: null });
  state().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
});
afterEach(() => { cleanup(); useKeybinds.getState().resetAll(); vi.unstubAllGlobals(); });

describe('Shift steps a group of options back', () => {
  spec('UI-73', 'Thickness, Auto Trim and Brush shape step back with Shift and their keys, and forward without it', () => {
    render(<Keys/>);
    for (const expected of [3, 2, 1]) { shifted('L'); expect(state().terrainThickness).toBe(expected); }
    shifted('Q');
    expect(state().autoEdgeCut).toBe('round');
    press('q');
    expect(state().autoEdgeCut, 'its key still steps forward').toBe('off');
    // Shift and 5 types % on this layout; the key is still the shape's 5.
    shifted('%', 'Digit5');
    expect(buildShapeOf(state())).toBe('circle');
    shifted('%', 'Digit5');
    expect(buildShapeOf(state())).toBe('rect');
    press('5', { code: 'Digit5' });
    expect(buildShapeOf(state())).toBe('circle');
  });

  spec('UI-73', 'a note\'s text size steps back with Shift and its key', () => {
    render(<Keys/>);
    act(() => { state().setEditMode({ mode: 'annotate' }); state().setAnnotationTool('zone'); state().setAnnotationSize('m'); });
    shifted('Q');
    expect(state().annotationSize).toBe('s');
    shifted('Q');
    expect(state().annotationSize, 'wrapping round to the last size').toBe('none');
  });

  spec('UI-73', 'follows the key the cycle is bound to', () => {
    render(<Keys/>);
    act(() => { useKeybinds.getState().rebind('tool.thickness_cycle', 'k'); });
    shifted('K');
    expect(state().terrainThickness).toBe(3);
    shifted('L');
    expect(state().terrainThickness, 'the old key has no way back').toBe(3);
  });

  spec('UI-73', 'is Shift with the cycle\'s key in every style, except where another command holds that combo and keeps it', () => {
    const backs = (id: string) => {
      const ways = reverseCombos(useKeybinds.getState().overrides, 'terrain');
      return { thickness: ways.get('tool.thickness_cycle') ?? null, shape: ways.get('tool.shape_cycle') ?? null, option: ways.get('tool.option_cycle') ?? null, id };
    };
    style('default');
    expect(backs('default')).toEqual({ thickness: 'shift+l', shape: 'shift+5', option: 'shift+q', id: 'default' });
    style('pro');
    expect(backs('pro'), 'Pro leaves the shape and option cycles unbound').toEqual({ thickness: 'shift+l', shape: null, option: null, id: 'pro' });
    style('numeric');
    expect(backs('numeric'), 'Numeric keeps Shift+Q for Mountains').toEqual({ thickness: 'shift+l', shape: 'shift+5', option: null, id: 'numeric' });

    render(<Keys/>);
    act(() => { state().setEditMode({ mode: 'water', arm: { kind: 'brush' } }); });
    shifted('Q');
    expect(state().editMode.mode, 'Shift+Q still opens Mountains').toBe('mountain');
    expect(state().autoEdgeCut).toBe('off');
  });

  spec('UI-73', 'a key that types another character with Shift gives no way back, and the Keyboard window claims none', () => {
    render(<Keys/>);
    act(() => { useKeybinds.getState().rebind('tool.thickness_cycle', ','); });
    expect(reverseCombos(useKeybinds.getState().overrides, 'terrain').has('tool.thickness_cycle')).toBe(false);
    press(',', { code: 'Comma' });
    expect(state().terrainThickness, 'the key still steps forward').toBe(2);
    shifted('<', 'Comma');
    expect(state().terrainThickness).toBe(2);
    cleanup();
    const { baseElement } = render(<I18nProvider><KeyboardModal open onClose={() => {}}/></I18nProvider>);
    fireEvent.click([...baseElement.querySelectorAll<HTMLElement>('#kbd-region [title]')].find((k) => k.title === 'Thickness')!);
    expect(screen.queryByText(LINE)).toBeNull();
  });

  spec('UI-73', 'the Keyboard window says so for a selected cycle that has a way back', () => {
    const { baseElement } = render(<I18nProvider><KeyboardModal open onClose={() => {}}/></I18nProvider>);
    const keycap = (title: string) => [...baseElement.querySelectorAll<HTMLElement>('#kbd-region [title]')].find((k) => k.title === title)!;
    expect(screen.queryByText(LINE)).toBeNull();
    fireEvent.click(keycap('Thickness'));
    expect(screen.getByText(LINE)).toBeTruthy();
    fireEvent.click(keycap('Brush'));
    expect(screen.queryByText(LINE), 'not for a command that is no cycle').toBeNull();
  });

  spec('UI-73', 'Help\'s shortcut table for the build tools says so', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    Element.prototype.scrollIntoView = () => {};
    useEditorStore.setState({ helpTarget: { page: 'terrain' } });
    const { baseElement } = render(<MotionConfig reducedMotion="always"><I18nProvider>
      <InputModeProvider inputMode="pc" shape="landscape"><HelpModal open onClose={() => {}}/></InputModeProvider>
    </I18nProvider></MotionConfig>);
    const table = await waitFor(() => { const found = baseElement.querySelector('#help-terrain-keys')?.closest('section'); expect(found).toBeTruthy(); return found!; });
    expect(within(table).getByText(LINE)).toBeTruthy();
  });
});
