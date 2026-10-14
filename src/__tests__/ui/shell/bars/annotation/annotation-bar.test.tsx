// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ZoneNote } from '../../../../../core/model/annotations';
import { ANNOTATION_COLORS } from '../../../../../config/annotation-palette';
import { useKeybinds } from '../../../../../state/keymap/store';
import { __resetTextVerdicts, recordTextVerdict } from '../../../../../state/text-verdicts';
import { useEditorStore } from '../../../../../state/store';
import { createDefaultRegistry } from '../../../../../rules';
import { I18nProvider } from '../../../../../i18n/context';
import { AnnotationDiscardModal } from '../../../../../ui/chrome/modals/AnnotationDiscardModal';
import { EditToolbar } from '../../../../../ui/shell/bars/EditToolbar';
import { useEditorShortcuts } from '../../../../../ui/shell/use-editor-shortcuts';
import { makeTemplate } from '../../../../_support/map-state';
import { brushSizeOf } from '../../../../../state/editing/edit-mode';

const state = () => useEditorStore.getState();
const zone = (): ZoneNote => ({ kind: 'zone', id: 'draft', cells: [{ x: 2, y: 2 }], tag: 'homes', color: ANNOTATION_COLORS[0]!, num: 1 });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const key = (value: string) => fireEvent.keyDown(window, { key: value });
function Editor() {
  useEditorShortcuts({ toggleMenu: vi.fn() });
  return <MotionConfig reducedMotion="always"><I18nProvider><EditToolbar bar="notes"/><AnnotationDiscardModal/></I18nProvider></MotionConfig>;
}

beforeEach(() => {
  state().initMap(makeTemplate(20, 20), createDefaultRegistry());
  useEditorStore.setState({ locale: 'en', annotationTool: 'zone', annotationTag: 'homes', annotationZoneShape: 'free', annotationSize: 'm', annotationRouteDashed: true, selectingRegion: false, drawingBrushSize: 1 });
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

  it('confirms before discarding an unfinished route when its tool is put down', () => {
    click('Route');
    const draft = { kind: 'route', id: 'route', points: [{ x: 2, y: 2 }, { x: 5, y: 4 }], color: ANNOTATION_COLORS[0]!, dashed: true } as const;
    act(() => { state().setAnnotationDraft({ ...draft, points: [...draft.points] }); state().setAnnotationSelection(['route']); });
    click('Route');
    expect(state().annotationTool).toBe('route');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(state().annotationTool).toBe('none');
    expect(state().annotationDraft).toBeNull();
    expect(state().annotationSelection).toEqual([]);
  });

  it('shows the width slider only for free, line, curve, routes and erasing', () => {
    for (const shape of ['Freehand', 'Line', 'Curve']) {
      click(shape); expect(screen.getByRole('slider')).toBeTruthy();
    }
    for (const tool of ['Rectangle', 'Circle', 'Tag chip']) {
      click(tool); expect(screen.queryByRole('slider')).toBeNull();
    }
    click('Route'); expect(screen.getByRole('slider')).toBeTruthy();
    click('Erase');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(brushSizeOf(state())).toBe(5);
    click('Rectangle'); expect(screen.queryByRole('slider')).toBeNull();
    click('Line'); expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('sizes routes on the brush slider from their own width, which edits the selected route', () => {
    act(() => {
      state().setBrushSize(2); state().setAnnotationRouteWidth(1);
      state().addAnnotation({ kind: 'route', id: 'r', points: [{ x: 2, y: 2 }, { x: 8, y: 3 }], color: ANNOTATION_COLORS[0]!, dashed: false });
    });
    click('Route');
    act(() => { state().setAnnotationSelection(['r']); });
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(state().annotationRouteWidth).toBe(5);
    expect(state().gridState?.annotations?.items[0]).toMatchObject({ width: 5 });
    expect(brushSizeOf(state())).toBe(2);
    click('Brush');
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
  });

  it('offers No text as a font size for zones only, and Q cycles through it', () => {
    act(() => { state().setAnnotationDraft(zone()); state().setAnnotationSize('l'); });
    click('No text');
    expect(state().annotationSize).toBe('none');
    expect(state().annotationDraft).toMatchObject({ size: 'none' });
    key('q'); expect(state().annotationSize).toBe('s');
    for (const size of ['m', 'l', 'none']) { key('q'); expect(state().annotationSize).toBe(size); }
    act(() => { state().setAnnotationDraft(null); });
    click('Tag chip');
    expect(screen.queryByRole('button', { name: 'No text' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');
    key('q'); expect(state().annotationSize).toBe('l');
  });

  it('shows and hides zone width and height with the region selection Dimensions picker', () => {
    act(() => { state().setAnnotationDimensions(true); });
    const group = () => screen.queryByRole('group', { name: 'Dimensions' });
    expect(group()).toBeTruthy();
    click('Hide dimensions');
    expect(state().annotationDimensions).toBe(false);
    click('Show dimensions');
    expect(state().annotationDimensions).toBe(true);
    click('Route');
    expect(group()).toBeNull();
  });

  it('gives the eraser the road eraser shapes, through the same picker and labels', () => {
    act(() => { state().setEraserShape('free'); });
    click('Erase');
    for (const [label, shape] of [['Line', 'line'], ['Curve', 'curve'], ['Rectangle', 'rect'], ['Circle', 'circle'], ['Freehand', 'free']] as const) {
      click(label);
      expect(state().eraserShape).toBe(shape);
      expect(state().annotationTool).toBe('erase');
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('saves the standing drawing from the confirmation before switching tools', () => {
    act(() => { state().setAnnotationDraft(zone()); });
    click('Route');
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getAllByRole('button').map(b => b.textContent)).toEqual(['Discard', 'Cancel', 'Save']);
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(state().gridState?.annotations?.items).toEqual([zone()]);
    expect(state().annotationDraft).toBeNull();
    expect(state().annotationDiscardAction).toBeNull();
    expect(state().annotationTool).toBe('route');
  });

  it('updates draft settings through the size, color and tag pickers', () => {
    act(() => { state().setAnnotationDraft(zone()); });
    click('Large'); click('Garden');
    fireEvent.click(within(screen.getByRole('group', { name: 'Annotation color' })).getAllByRole('button')[2]!);
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

  it('uses 1–5 to toggle tools, 6 for the brush or eraser shape and Escape for selection', () => {
    act(() => { state().setEraserShape('free'); });
    for (const shape of ['line', 'curve', 'rect', 'circle', 'free']) {
      key('6'); expect(state().annotationZoneShape).toBe(shape);
    }
    key('6'); key('2'); key('6');
    expect(state().annotationTool).toBe('erase'); expect(state().annotationZoneShape).toBe('line');
    expect(state().eraserShape).toBe('line');
    key('2'); expect(state().annotationTool).toBe('none');
    for (const [digit, tool] of [['3', 'chip'], ['4', 'route'], ['5', 'measure']]) {
      key(digit!); expect(state().annotationTool).toBe(tool);
      key(digit!); expect(state().annotationTool).toBe('none');
    }
    expect(screen.getByRole('button', { name: 'Measure' }).title).toBe('Measure (5)');
    key('1'); expect(state().annotationTool).toBe('zone'); expect(state().annotationZoneShape).toBe('line');
    key('Escape'); expect(state().annotationTool).toBe('none');
  });
  it('Escape asks before discarding the draft and disarming the tool', () => {
    act(() => { state().setAnnotationDraft(zone()); state().setAnnotationSelection(['draft']); });
    key('Escape');
    expect(state().annotationTool).toBe('zone');
    expect(state().annotationDraft).not.toBeNull();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(state().annotationTool).toBe('none');
    expect(state().annotationDraft).toBeNull();
    expect(state().annotationSelection).toEqual([]);
  });

});


it('toggles the selected text tag off while retaining the painted region', () => {
  act(() => { state().setAnnotationDraft(zone()); });
  click('Homes');
  expect(state().annotationTag).toBeNull();
  expect(state().annotationDraft).toMatchObject({ tag: null, cells: zone().cells });
  expect(screen.getByRole('button', { name: 'Homes' }).getAttribute('aria-pressed')).toBe('false');
  click('Homes'); expect(state().annotationDraft).toMatchObject({ tag: 'homes' });
});

describe('custom tags in the tag row', () => {
  const pill = (name: string) => screen.queryByRole('button', { name });
  afterEach(() => __resetTextVerdicts());

  it('lists approved custom tags after the presets, before the add and remove pills', () => {
    act(() => { state().addCustomTag('Orchard row'); state().addCustomTag('North pier'); recordTextVerdict('Orchard row', true); });
    const names = within(screen.getByRole('group', { name: 'Tag' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.slice(-3)).toEqual(['Orchard row', 'Add a tag', 'Remove tags']);
    expect(pill('North pier')).toBeNull();
  });

  it('picks a custom tag like a preset and clears it on a repeated choice', () => {
    act(() => { state().addCustomTag('Orchard row'); recordTextVerdict('Orchard row', true); state().setAnnotationTag('homes'); state().setAnnotationDraft(zone()); });
    const id = state().gridState!.annotations!.customTags![0]!.id;
    click('Orchard row');
    expect(state().annotationDraft).toMatchObject({ tag: id });
    click('Orchard row');
    expect(state().annotationDraft).toMatchObject({ tag: null });
  });

  it('offers removal only while the map has custom tags', () => {
    expect((pill('Remove tags') as HTMLButtonElement).disabled).toBe(true);
    act(() => { state().addCustomTag('Orchard row'); recordTextVerdict('Orchard row', true); });
    expect((pill('Remove tags') as HTMLButtonElement).disabled).toBe(false);
  });

  it('removes a pressed custom tag in removal, undo brings it back, and Escape leaves removal', () => {
    act(() => {
      for (const text of ['Orchard row', 'North pier']) { state().addCustomTag(text); recordTextVerdict(text, true); }
      state().setAnnotationTag('homes');
    });
    click('Remove tags');
    expect(pill('Remove tags')!.getAttribute('aria-pressed')).toBe('true');
    click('Remove “Orchard row”');
    expect(state().gridState!.annotations!.customTags!.map((t) => t.text)).toEqual(['North pier']);
    expect(pill('Remove “North pier”')).not.toBeNull();
    // Presets stay, unavailable while tags are being removed.
    expect((pill('Homes') as HTMLButtonElement).disabled).toBe(true);
    // A key press reaches the document before the window's editor shortcuts.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(pill('North pier')).not.toBeNull();
    expect(state().annotationTool).toBe('zone');
    expect((pill('Homes') as HTMLButtonElement).disabled).toBe(false);
    act(() => { state().undoAnnotation(); });
    expect(pill('Orchard row')).not.toBeNull();
  });

  it('leaves removal once the last custom tag goes', () => {
    act(() => { state().addCustomTag('Orchard row'); recordTextVerdict('Orchard row', true); });
    click('Remove tags');
    click('Remove “Orchard row”');
    expect(pill('Remove tags')!.getAttribute('aria-pressed')).toBe('false');
  });
});

it('Cancel preserves the draft and active tool', () => {
  act(() => { state().setAnnotationDraft(zone()); });
  click('Route');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(state().annotationTool).toBe('zone');
  expect(state().annotationDraft).toEqual(zone());
});
