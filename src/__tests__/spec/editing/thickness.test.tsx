// @vitest-environment jsdom
/** The mountain brush's and eraser's thickness: the Layers group in the brush bar, its key, and the
 *  strokes that read it. */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { useKeybinds } from '../../../state/keymap/store';
import { PRESETS } from '../../../state/keymap/registry';
import { effectiveCombo, currentBinds, overridesFor } from '../../../state/keymap/resolve';
import { useEditorStore } from '../../../state/store';
import { armingOf } from '../../../state/editing/arming';
import { I18nProvider } from '../../../i18n/context';
import { EditToolbar } from '../../../ui/shell/bars/EditToolbar';
import { useEditorShortcuts } from '../../../ui/shell/use-editor-shortcuts';
import { rect, TerrainType, world } from '../_world';
import { brush } from './_editing';
import type { BuildMode } from '../../../state/editing/edit-mode';

function Editor() {
  useEditorShortcuts({ toggleMenu: () => {} });
  const mode = useEditorStore((s) => s.editMode.mode);
  return <MotionConfig reducedMotion="always"><I18nProvider>
    <EditToolbar bar={mode === 'water' || mode === 'road' ? mode : 'mountain'}/>
  </I18nProvider></MotionConfig>;
}
const state = () => useEditorStore.getState();
const group = () => screen.queryByRole('group', { name: 'Thickness' });
const key = (value: string) => fireEvent.keyDown(window, { key: value });
const arm = (mode: BuildMode, kind: 'brush' | 'erase' | 'trim' | 'none') => state().setEditMode({ mode, arm: { kind } });

beforeEach(() => {
  useKeybinds.getState().resetAll();
  useEditorStore.setState({ locale: 'en', selectingRegion: false, eraserShape: 'free', autoEdgeCut: 'off', terrainThickness: 1, planetSession: null });
  arm('mountain', 'brush');
  render(<Editor/>);
});
afterEach(() => { cleanup(); useKeybinds.getState().resetAll(); });

describe('the thickness of a mountain stroke', () => {
  spec('EDIT-80', 'starts at one layer, each option showing no number, only its name to a reader', () => {
    expect(useEditorStore.getInitialState().terrainThickness).toBe(1);
    const options = within(group()!).getAllByRole('button');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['1 layer', '2 layers', '3 layers']);
    expect(options.map((o) => o.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(options.map((o) => o.textContent)).toEqual(['', '', '']);
  });

  spec('EDIT-80', 'the option pressed sets the thickness the strokes build with', () => {
    fireEvent.click(within(group()!).getByRole('button', { name: '2 layers' }));
    expect(state().terrainThickness).toBe(2);
    const arming = armingOf(state());
    expect(arming.terrainThickness).toBe(2);
    const w = world();
    const o = w.openGround(3, 3);
    brush(w, { terrainThickness: arming.terrainThickness }).click(o);
    expect(w.terrainAt(o)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(rect(o, 1, 1).length).toBe(1);
  });

  spec('EDIT-80', 'its key steps through 1, 2 and 3 under the mountain brush and eraser, and does nothing elsewhere', () => {
    for (const expected of [2, 3, 1]) { key('l'); expect(state().terrainThickness).toBe(expected); }
    arm('mountain', 'erase');
    key('l');
    expect(state().terrainThickness).toBe(2);
    arm('water', 'brush');
    key('l');
    expect(state().terrainThickness, 'water has no thickness').toBe(2);
    arm('mountain', 'trim');
    key('l');
    expect(state().terrainThickness, 'nor the corner tool').toBe(2);
  });

  spec('EDIT-80', 'its key is L in every shortcut style, clashing with no other command', () => {
    expect(effectiveCombo({}, 'tool.thickness_cycle')).toBe('l');
    for (const preset of PRESETS) {
      const binds = currentBinds(overridesFor(preset.binds));
      expect(binds.get('tool.thickness_cycle'), preset.id).toBe('l');
      expect([...binds].filter(([, combo]) => combo === 'l').map(([id]) => id), preset.id).toEqual(['tool.thickness_cycle']);
    }
  });

  spec('EDIT-80', 'shows for the mountain brush, its shapes and the eraser only', async () => {
    expect(group()).not.toBeNull();
    state().setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: 'rect' } });
    expect(group(), 'a mountain shape').not.toBeNull();
    arm('mountain', 'erase');
    expect(group(), 'the mountain eraser').not.toBeNull();
    for (const [mode, kind] of [['mountain', 'trim'], ['mountain', 'none'], ['water', 'brush'], ['water', 'erase'], ['road', 'brush']] as const) {
      arm(mode, kind);
      // A group leaving the bar stays mounted through its exit.
      await waitFor(() => expect(group(), `${mode} ${kind}`).toBeNull());
    }
  });

  spec('EDIT-80', 'is kept for the visit as the brush size is, and like it is never stored', () => {
    const stored = () => Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).map((k) => [k, localStorage.getItem(k)]),
    );
    const before = stored();
    state().setBrushSize(4);
    fireEvent.click(within(group()!).getByRole('button', { name: '3 layers' }));
    expect([state().drawingBrushSize, state().terrainThickness]).toEqual([4, 3]);
    expect(stored()).toEqual(before);
  });

  spec('EDIT-80', 'choosing a thickness records no undo step', () => {
    const w = world();
    useEditorStore.setState({ gridState: w.state, commandExecutor: w.sandbox.executor });
    const depth = w.sandbox.executor.historyDepth();
    fireEvent.click(within(group()!).getByRole('button', { name: '3 layers' }));
    key('l');
    expect(state().terrainThickness).toBe(1);
    expect(w.sandbox.executor.historyDepth()).toBe(depth);
  });
});
