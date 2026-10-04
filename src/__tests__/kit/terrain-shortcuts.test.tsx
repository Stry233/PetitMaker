import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { bindingIndex, effectiveCombo, useKeybinds } from '../../core/runtime/keybindings';
import { designModeToEditInputs } from '../../core/model/edit-mode';
import { useEditorStore } from '../../state/store';
import { I18nProvider } from '../../i18n/context';
import { TerrainBar } from '../../ui/shell/bars/TerrainBar';
import { AnnotationBar } from '../../ui/shell/bars/AnnotationBar';
import { useEditorShortcuts } from '../../ui/shell/use-editor-shortcuts';
import type { CommandContext } from '../../kit/commands';

const context: CommandContext = {
  openBuild: design => useEditorStore.getState().setEditMode({ mode: 'mountain', ...designModeToEditInputs(design) }),
  handleTileAction: vi.fn(), toggleMenu: vi.fn(),
};
function Editor() {
  useEditorShortcuts(context);
  const mode = useEditorStore(s => s.editMode.mode);
  return <MotionConfig reducedMotion="always"><I18nProvider>
    {mode === 'annotate' ? <AnnotationBar/> : <TerrainBar surface={mode === 'water' || mode === 'road' ? mode : 'mountain'}/>}
  </I18nProvider></MotionConfig>;
}
const key = (value: string) => fireEvent.keyDown(window, { key: value });
const state = () => useEditorStore.getState();

beforeEach(() => {
  useKeybinds.getState().resetAll();
  useEditorStore.setState({ locale: 'en', selectingRegion: false, eraserShape: 'dot', autoEdgeCut: 'off' });
  state().setEditMode({ mode: 'mountain', tool: 'brush' });
  render(<Editor/>);
});
afterEach(() => { cleanup(); useKeybinds.getState().resetAll(); });

describe('terrain keyboard controls', () => {
  it('follows the visible tool and shape order', () => {
    const commands = ['tool.brush', 'tool.eraser', 'tool.edgecut', 'tool.smart', 'tool.shape_cycle'];
    commands.forEach((command, index) => expect(bindingIndex({}, 'terrain').get(String(index + 1))).toBe(command));
    expect(bindingIndex({}, 'terrain').get('q')).toBe('tool.auto_trim');
  });

  it('restores the drawing shape and toggles each main tool off with its key', () => {
    key('5'); key('5'); key('5'); expect(state().editMode.shape).toBe('rect');
    key('2'); key('5'); key('5'); key('5'); key('5'); expect(state().eraserShape).toBe('circle');
    key('2'); expect(state().editMode.tool).toBe('none');
    for (const [digit, tool] of [['1', 'shape'], ['2', 'erase'], ['3', 'trim'], ['4', 'smart']]) {
      key(digit!); expect(state().editMode.tool).toBe(tool);
      key(digit!); expect(state().editMode.tool).toBe('none');
      expect(state().armedMacro).toBeNull();
    }
    key('1'); expect(state().designMode).toBe('rect');
  });

  it.each(['1', '2', '3', '4'])('Escape puts down tool %s without leaving the surface', digit => {
    key('Escape'); key(digit); key('Escape');
    expect(state().editMode.tool).toBe('none');
    expect(state().editMode.mode).toBe('mountain');
    expect(state().armedMacro).toBeNull();
  });

  it('cycles shapes in order for drawing and erasing', () => {
    for (const shape of ['line', 'curve', 'rect', 'circle', 'free']) {
      key('5'); expect(state().editMode.shape).toBe(shape);
      expect(state().editMode.tool).toBe(shape === 'free' ? 'brush' : 'shape');
    }
    key('2');
    for (const shape of ['line', 'curve', 'rect', 'circle', 'dot']) {
      key('5'); expect(state().eraserShape).toBe(shape); expect(state().editMode.tool).toBe('erase');
    }
  });

  it('cycles Auto Trim with Q while drawing or erasing and preserves it for other tools', () => {
    for (const mode of ['rect', 'round', 'off']) { key('q'); expect(state().autoEdgeCut).toBe(mode); }
    key('2');
    for (const mode of ['rect', 'round', 'off']) { key('q'); expect(state().autoEdgeCut).toBe(mode); }
    for (const digit of ['3', '4']) {
      key(digit); key('q'); expect(state().autoEdgeCut).toBe('off');
    }
    const tool = state().editMode.tool;
    key('5'); expect(state().editMode.tool).toBe(tool);
    expect(state().editMode.mode).toBe('mountain');
    key('5'); expect(state().editMode.tool).toBe(tool);
  });

  it('uses rebound shortcuts and preserves text-field typing', () => {
    act(() => { useKeybinds.getState().rebind('tool.auto_trim', 't'); });
    key('q'); expect(state().autoEdgeCut).toBe('off');
    key('t'); expect(state().autoEdgeCut).toBe('rect');
    expect(screen.getByText('T')).toBeTruthy();
    const input = document.createElement('input'); document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 't' }); expect(state().autoEdgeCut).toBe('rect'); input.remove();
  });

  it('gives saved custom bindings precedence over new defaults', () => {
    const saved = { 'tool.brush': '5' };
    expect(effectiveCombo(saved, 'tool.brush')).toBe('5');
    expect(effectiveCombo(saved, 'tool.measure')).toBeNull();
    expect(bindingIndex(saved).get('5')).toBe('tool.brush');
  });

  it.each(['terrain', 'notes-zone'] as const)('shares Brush rebinding, clearing and reset from %s across editing modes', toolbar => {
    act(() => { useKeybinds.getState().rebind('tool.brush', 'j', toolbar); });
    for (const mode of ['mountain', 'water', 'road', 'annotate'] as const) {
      act(() => {
        state().setEditMode({ mode, tool: 'none', shape: 'free' });
        state().setAnnotationTool('none');
      });
      const brush = screen.getByRole('button', { name: 'Brush' });
      expect(brush.title).toBe('Brush (J)');
      expect(brush.parentElement?.textContent).toContain('J');
      key('1'); expect(brush.getAttribute('aria-pressed')).toBe('false');
      key('j'); expect(brush.getAttribute('aria-pressed')).toBe('true');
      key('j'); expect(brush.getAttribute('aria-pressed')).toBe('false');
    }
    act(() => { useKeybinds.getState().clear('tool.brush'); });
    for (const mode of ['mountain', 'annotate'] as const) {
      act(() => state().setEditMode({ mode, tool: 'none' }));
      const brush = screen.getByRole('button', { name: 'Brush' });
      expect(brush.title).toBe('Brush');
      key('j'); expect(brush.getAttribute('aria-pressed')).toBe('false');
    }
    act(() => { useKeybinds.getState().rebind('tool.brush', '1', toolbar); });
    for (const mode of ['mountain', 'annotate'] as const) {
      act(() => state().setEditMode({ mode, tool: 'none' }));
      const brush = screen.getByRole('button', { name: 'Brush' });
      expect(brush.title).toBe('Brush (1)');
      key('1'); expect(brush.getAttribute('aria-pressed')).toBe('true');
      key('1'); expect(brush.getAttribute('aria-pressed')).toBe('false');
    }
  });
  it('adapts numbers and the final options key when switching to annotations', () => {
    act(() => state().setEditMode({ mode: 'annotate' }));
    key('5'); expect(state().annotationTool).toBe('measure');
    key('5'); expect(state().annotationTool).toBe('none');
    key('1'); expect(state().annotationTool).toBe('zone');
    key('6'); expect(state().annotationZoneShape).toBe('line');
    act(() => state().setAnnotationSize('s'));
    key('q'); expect(state().annotationSize).toBe('m');
    key('3'); expect(state().annotationTool).toBe('chip');
    key('q'); expect(state().annotationSize).toBe('l');
    key('4'); expect(state().annotationTool).toBe('route');
    const dashed = state().annotationRouteDashed;
    key('q'); expect(state().annotationRouteDashed).toBe(!dashed);
    key('2'); key('q'); expect(state().annotationRouteDashed).toBe(!dashed);
    act(() => state().setEditMode({ mode: 'water', tool: 'brush', shape: 'free' }));
    key('5'); expect(state().editMode.shape).toBe('line');
  });

});
