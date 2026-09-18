import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { ToolType } from '../../../core/model/types';
import { RUN } from '../../../kit/commands';
import { useKeybinds } from '../../../core/runtime/keybindings';
import { I18nProvider, localizedName } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { getRoadMaterials } from '../../../state/catalog';
import { ScaleProvider } from '../../../ui/design/scale';
import { apparentSize } from '../../../ui/shell/frame';
import { SCALE } from '../../../ui/shell/units';
import { SLIDER_LIFT, TerrainBar } from '../../../ui/shell/bars/TerrainBar';
import { BRUSH, CELL, GLYPH, TOOL_CELLS, type TerrainSurface } from '../../../ui/shell/bars/terrain-cells';

const surfaces: TerrainSurface[] = ['mountain', 'water', 'road'];
function mount(surface: TerrainSurface = 'mountain') {
  useEditorStore.getState().setEditMode({ mode: surface, tool: 'brush' });
  return render(<MotionConfig reducedMotion="always"><I18nProvider><ScaleProvider value={SCALE}><TerrainBar surface={surface}/></ScaleProvider></I18nProvider></MotionConfig>);
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const size = (key: string) => fireEvent.keyDown(screen.getByRole('slider'), { key });
const active = (name: string) => expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', brushSize: 1, drawingBrushSize: 1, eraserBrushSize: 1, eraserShape: 'dot', autoEdgeCut: 'off', tileMaterial: getRoadMaterials()[0]!.id, tileMaterialPicked: false });
  useKeybinds.getState().resetAll();
});
afterEach(() => { cleanup(); useKeybinds.getState().resetAll(); });

describe.each(surfaces)('%s terrain controls', surface => {
  it.each([['Freehand', 'brush'], ['Line', 'line'], ['Curve', 'curve'], ['Rectangle', 'rect'], ['Circle', 'circle']])('%s arms the drawing geometry', (label, designMode) => {
    mount(surface); click(label);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);
    expect(useEditorStore.getState().designMode).toBe(designMode);
    active('Brush'); active(label);
    expect(useEditorStore.getState().contentType).toBe(surface === 'road' ? 'tile' : surface);
  });

  it.each([['Freehand', 'dot'], ['Line', 'line'], ['Curve', 'curve'], ['Rectangle', 'rect'], ['Circle', 'circle']])('%s changes the eraser footprint', (label, shape) => {
    mount(surface); click('Eraser'); click(label);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Eraser);
    expect(useEditorStore.getState().eraserShape).toBe(shape);
    active('Eraser'); active(label);
  });

  it('shows Auto Trim for erasing and cycles it through the pill and shortcut', () => {
    mount(surface); click('Eraser');
    const group = screen.getByRole('group', { name: 'Auto Trim' });
    fireEvent.click(within(group).getAllByRole('button')[1]!);
    expect(useEditorStore.getState().autoEdgeCut).toBe('rect');
    act(() => { RUN['tool.auto_trim']!({} as never); });
    expect(useEditorStore.getState().autoEdgeCut).toBe('round');
    act(() => { RUN['tool.auto_trim']!({} as never); });
    expect(useEditorStore.getState().autoEdgeCut).toBe('off');
    click('Edge Cut');
    expect(screen.queryByRole('group', { name: 'Auto Trim' })).toBeNull();
    act(() => { RUN['tool.auto_trim']!({} as never); });
    expect(useEditorStore.getState().autoEdgeCut).toBe('off');
  });

  it('keeps the primary captions fixed when shape and size change', () => {
    mount(surface);
    for (const shape of ['Line', 'Curve', 'Rectangle', 'Circle']) {
      click(shape); expect(screen.getByText('Brush')).toBeTruthy();
    }
    click('Eraser'); click('Curve'); size('End');
    expect(screen.getByText('Eraser')).toBeTruthy();
    click('Edge Cut'); expect(screen.getByText('Edge Cut')).toBeTruthy();
    click('Smart build'); expect(screen.getByText('Smart build')).toBeTruthy();
  });

  it('restores each tool’s shape and width when switching back', () => {
    mount(surface); size('End'); click('Rectangle');
    click('Eraser'); expect(useEditorStore.getState().brushSize).toBe(1);
    size('ArrowRight'); click('Circle');
    click('Brush'); active('Rectangle'); expect(useEditorStore.getState().brushSize).toBe(5);
    click('Eraser'); active('Circle'); expect(useEditorStore.getState().brushSize).toBe(2);
  });

  it('keeps an explicitly selected tool armed on repeated presses', () => {
    mount(surface); click('Rectangle'); click('Brush'); click('Brush');
    expect(useEditorStore.getState().designMode).toBe('rect');
    click('Smart build'); click('Smart build');
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Macro);
  });

  it.each(['Edge Cut', 'Smart build'])('%s replaces the paint tool and hides its shape settings', label => {
    mount(surface); click('Eraser'); click(label); active(label);
    expect(screen.getByRole('button', { name: 'Eraser' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Brush shape' })).toBeNull();
    expect(document.querySelector('[data-terrain-divider]')).toBeNull();
    expect(!!screen.queryByRole('slider')).toBe(label === 'Smart build');
  });
});

describe('brush size', () => {
  it.each(['Rectangle', 'Circle', 'Edge Cut'])('%s hides the unavailable slider', label => {
    mount(); click(label); expect(screen.queryByRole('slider')).toBeNull();
    expect(useEditorStore.getState().brushSize).toBe(1);
  });
  it.each(['Line', 'Curve'])('the %s eraser retains an adjustable width', label => {
    mount(); click('Eraser'); click(label); size('End');
    expect(useEditorStore.getState().brushSize).toBe(5);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('5 cells');
  });
  it('bounds keyboard input and shows singular and plural readings', () => {
    mount(); expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('1 cell');
    size('End'); size('ArrowRight'); expect(useEditorStore.getState().brushSize).toBe(5);
    size('Home'); size('ArrowLeft'); expect(useEditorStore.getState().brushSize).toBe(1);
  });
  it('keeps its original alignment with the tool row', () => {
    expect((BRUSH.centreY - BRUSH.track.y) * SCALE + SLIDER_LIFT).toBeCloseTo(CELL.h * SCALE / 2);
  });
});

describe('surface and shortcut affordances', () => {
  it('keeps catalog material names and selection in the road row', () => {
    mount('road'); const items = getRoadMaterials();
    const buttons = within(screen.getByRole('group', { name: 'Road Surface' })).getAllByRole('button');
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(items.map(i => localizedName(i.name, 'en')));
    fireEvent.click(buttons[1]!); expect(useEditorStore.getState().tileMaterial).toBe(items[1]!.id);
  });
  it('shows current shortcut bindings on the actions they perform', () => {
    mount(); expect(screen.getByRole('group', { name: 'Brush shape' }).parentElement?.textContent).toContain('5');
    expect(screen.getByRole('button', { name: 'Freehand' }).title).toBe('Freehand');
    act(() => { useKeybinds.getState().rebind('tool.free', 'k'); });
    expect(screen.getByRole('button', { name: 'Freehand' }).title).toContain('(K)');
    click('Eraser'); expect(screen.getByRole('button', { name: 'Freehand' }).title).toContain('(K)');
  });
  it.each([['mountain', 'raise'], ['water', 'stream'], ['road', 'road-link']] as const)('%s keeps its existing Smart Build action', (surface, macro) => {
    mount(surface); click('Smart build'); expect(useEditorStore.getState().armedMacro).toBe(macro);
    click('Brush'); expect(useEditorStore.getState().armedMacro).toBeNull();
  });
  it('keeps the original glyph set optically balanced', () => {
    for (const surface of surfaces) {
      const spans = TOOL_CELLS.map(c => Math.hypot(c.glyph[surface].ink.w, c.glyph[surface].ink.h) * GLYPH / apparentSize(c.glyph[surface].ink));
      expect(Math.max(...spans) / Math.min(...spans)).toBeLessThan(1.25);
    }
  });
});
