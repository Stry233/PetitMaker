import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { ANNOTATION_COLORS, type ZoneNote } from '../../../core/model/annotations';
import { useKeybinds } from '../../../core/runtime/keybindings';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { I18nProvider } from '../../../i18n/context';
import { AnnotationBar } from '../../../ui/shell/bars/AnnotationBar';
import { useEditorShortcuts } from '../../../ui/shell/use-editor-shortcuts';
import { makeTemplate } from '../../rules/_helpers';

const state = () => useEditorStore.getState();
const zone = (): ZoneNote => ({ kind: 'zone', id: 'draft', cells: [{ x: 2, y: 2 }], tag: 'homes', color: ANNOTATION_COLORS[0]!, num: 1 });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const key = (value: string) => fireEvent.keyDown(window, { key: value });
function Editor() {
  useEditorShortcuts({ openBuild: vi.fn(), handleTileAction: vi.fn(), toggleMenu: vi.fn() });
  return <MotionConfig reducedMotion="always"><I18nProvider><AnnotationBar/></I18nProvider></MotionConfig>;
}

beforeEach(() => {
  state().initMap(makeTemplate(20, 20), createDefaultRegistry());
  useEditorStore.setState({ locale: 'en', brushSize: 1, annotationTool: 'zone', annotationZoneShape: 'free', annotationSize: 'm', annotationRouteDashed: true, selectingRegion: false });
  state().setEditMode({ mode: 'annotate' });
  useKeybinds.getState().resetAll();
  render(<Editor/>);
});
afterEach(() => { cleanup(); useKeybinds.getState().resetAll(); });

describe('annotation tool pills', () => {
  it.each([['Brush', 'zone'], ['Erase', 'erase'], ['Tag chip', 'chip'], ['Route', 'route'], ['Measure', 'measure']])('toggles %s off and on with repeated clicks', (label, tool) => {
    act(() => { state().setAnnotationTool('none'); });
    click(label); expect(state().annotationTool).toBe(tool);
    click(label); expect(state().annotationTool).toBe('none');
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('false');
    click(label); expect(state().annotationTool).toBe(tool);
  });

  it.each([['Freehand', 'free'], ['Line', 'line'], ['Curve', 'curve'], ['Rectangle', 'rect'], ['Circle', 'circle']])('selects %s inside the Brush shape pill', (label, shape) => {
    click(label);
    expect(state().annotationZoneShape).toBe(shape);
    expect(screen.getByRole('button', { name: 'Brush' }).getAttribute('aria-pressed')).toBe('true');
    click('Erase'); click('Brush');
    expect(state().annotationZoneShape).toBe(shape);
  });

  it('discards an unfinished route when its tool is put down', () => {
    click('Route');
    const draft = { kind: 'route', id: 'route', points: [{ x: 2, y: 2 }, { x: 5, y: 4 }], color: ANNOTATION_COLORS[0]!, dashed: true } as const;
    act(() => { state().setAnnotationDraft({ ...draft, points: [...draft.points] }); state().setAnnotationSelection(['route']); });
    click('Route');
    expect(state().annotationTool).toBe('none');
    expect(state().annotationDraft).toBeNull();
    expect(state().annotationSelection).toEqual([]);
  });

  it('shows the width slider only for free, line, curve and erasing', () => {
    for (const shape of ['Freehand', 'Line', 'Curve']) {
      click(shape); expect(screen.getByRole('slider')).toBeTruthy();
    }
    for (const tool of ['Rectangle', 'Circle', 'Tag chip', 'Route']) {
      click(tool); expect(screen.queryByRole('slider')).toBeNull();
    }
    click('Erase');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(state().brushSize).toBe(5);
    expect(screen.queryByRole('group', { name: 'Brush shape' })).toBeNull();
  });

  it('updates draft settings through the size, color and tag pickers', () => {
    act(() => { state().setAnnotationDraft(zone()); });
    click('Large'); click('Garden');
    fireEvent.click(within(screen.getByRole('group', { name: 'Note color' })).getAllByRole('button')[2]!);
    expect(state().annotationDraft).toMatchObject({ size: 'l', tag: 'garden', color: ANNOTATION_COLORS[2] });
    click('Done');
    expect(state().annotationDraft).toBeNull();
    expect(state().gridState?.annotations?.items).toHaveLength(1);
    act(() => { state().setAnnotationDraft({ ...zone(), id: 'discarded' }); });
    click('Discard');
    expect(state().annotationDraft).toBeNull();
    expect(state().gridState?.annotations?.items).toHaveLength(1);
  });

  it('offers explicit route styles while keeping unrelated settings hidden', () => {
    click('Route'); click('Solid'); expect(state().annotationRouteDashed).toBe(false);
    click('Dashed'); expect(state().annotationRouteDashed).toBe(true);
    expect(screen.queryByRole('group', { name: 'Font size' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Brush shape' })).toBeNull();
  });

  it('follows a rebound Measure key and leaves text input alone', () => {
    act(() => { useKeybinds.getState().rebind('tool.measure', '8'); });
    key('5'); expect(state().annotationTool).toBe('zone');
    const input = document.createElement('input'); document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '8' }); expect(state().annotationTool).toBe('zone'); input.remove();
    key('8'); expect(state().annotationTool).toBe('measure');
    expect(screen.getByRole('button', { name: 'Measure' }).title).toBe('Measure (8)');
  });

  it('uses 1–5 to toggle tools, 6 for brush shape and Escape for selection', () => {
    for (const shape of ['line', 'curve', 'rect', 'circle', 'free']) {
      key('6'); expect(state().annotationZoneShape).toBe(shape);
    }
    key('6'); key('2'); key('6');
    expect(state().annotationTool).toBe('erase'); expect(state().annotationZoneShape).toBe('line');
    key('2'); expect(state().annotationTool).toBe('none');
    for (const [digit, tool] of [['3', 'chip'], ['4', 'route'], ['5', 'measure']]) {
      key(digit!); expect(state().annotationTool).toBe(tool);
      key(digit!); expect(state().annotationTool).toBe('none');
    }
    expect(screen.getByRole('button', { name: 'Measure' }).title).toBe('Measure (5)');
    key('1'); expect(state().annotationTool).toBe('zone'); expect(state().annotationZoneShape).toBe('line');
    key('Escape'); expect(state().annotationTool).toBe('none');
  });
  it('Escape cancels the draft, selection and active tool in one press', () => {
    act(() => { state().setAnnotationDraft(zone()); state().setAnnotationSelection(['draft']); });
    key('Escape');
    expect(state().annotationTool).toBe('none');
    expect(state().annotationDraft).toBeNull();
    expect(state().annotationSelection).toEqual([]);
  });

});
