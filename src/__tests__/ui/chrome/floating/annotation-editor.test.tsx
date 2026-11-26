// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { createDefaultRegistry } from '../../../../rules';
import { AnnotationEditor } from '../../../../ui/chrome/floating/AnnotationEditor';
import { makeTemplate } from '../../../_support/map-state';

vi.mock('../../../../view/active-view', () => ({
  getActiveView: () => ({ projection: {
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
    screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
  } }),
  onActiveViewChange: () => () => {},
  onProjectionChange: () => () => {},
}));
const s = () => useEditorStore.getState();
const note = () => s().gridState!.annotations!.items[0]!;
beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  s().initMap(makeTemplate(20, 20), createDefaultRegistry());
  useEditorStore.setState({ locale: 'en' });
  s().setEditMode({ mode: 'annotate' });
  s().addAnnotation({ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 2, y: 4 }, { x: 8, y: 4 }], flipped: true });
  s().setAnnotationSelection(['m']);
  render(<I18nProvider><AnnotationEditor /></I18nProvider>);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('resizes on its axis through several pointer moves as one undo step', () => {
  const original = note();
  const lane = s().annotationUndoLane.length;
  const end = screen.getByRole('button', { name: 'Measurement endpoint 2' });
  fireEvent.pointerDown(end, { button: 0, clientX: 80, clientY: 40 });
  fireEvent.pointerMove(end, { clientX: 110, clientY: 100 });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 11, y: 4 }] });
  fireEvent.pointerMove(end, { clientX: 150, clientY: 80 });
  fireEvent.pointerUp(end, { clientX: 150, clientY: 80 });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 15, y: 4 }], flipped: true });
  expect(s().annotationUndoLane.length).toBe(lane + 1);
  act(() => { s().undoAnnotation(); });
  expect(note()).toEqual(original);
  act(() => { s().redoAnnotation(); });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 15, y: 4 }] });
});

it('preserves the grab offset and makes a click without movement a no-op', () => {
  const lane = s().annotationUndoLane.length;
  const end = screen.getByRole('button', { name: 'Measurement endpoint 2' });
  fireEvent.pointerDown(end, { button: 0, clientX: 87, clientY: 43 });
  fireEvent.pointerUp(end, { clientX: 87, clientY: 43 });
  expect(s().annotationUndoLane.length).toBe(lane);
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 8, y: 4 }] });
});

it('ignores pointer movement after history changes and hides handles when locked or deselected', () => {
  const end = screen.getByRole('button', { name: 'Measurement endpoint 2' });
  fireEvent.pointerDown(end, { button: 0, clientX: 80, clientY: 40 });
  fireEvent.pointerMove(end, { clientX: 110, clientY: 40 });
  act(() => { s().undoAnnotation(); });
  fireEvent.pointerMove(end, { clientX: 150, clientY: 40 });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 8, y: 4 }] });
  act(() => { s().setAnnotationsLocked(true); });
  expect(screen.queryByRole('button', { name: 'Measurement endpoint 2' })).toBeNull();
  act(() => { s().setAnnotationsLocked(false); s().setAnnotationSelection([]); });
  expect(screen.queryByRole('button', { name: 'Measurement endpoint 2' })).toBeNull();
});

it('supports keyboard resizing in half-cell steps and clamps endpoints to the map', () => {
  const end = screen.getByRole('button', { name: 'Measurement endpoint 2' });
  fireEvent.keyDown(end, { key: 'ArrowRight' });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 8.5, y: 4 }] });
  fireEvent.pointerDown(end, { button: 0, clientX: 90, clientY: 40 });
  fireEvent.pointerMove(end, { clientX: 900, clientY: 400 });
  fireEvent.pointerUp(end, { clientX: 900, clientY: 400 });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 19, y: 4 }] });
});

it('keeps both short-span endpoints reachable without changing a click into a resize', () => {
  act(() => { s().setMeasurementPoints('m', [{ x: 2, y: 4 }, { x: 3, y: 4 }], true); });
  const first = screen.getByRole('button', { name: 'Measurement endpoint 1' });
  const last = screen.getByRole('button', { name: 'Measurement endpoint 2' });
  expect(parseFloat(last.style.left) - parseFloat(first.style.left)).toBe(40);
  const lane = s().annotationUndoLane.length;
  const x = parseFloat(last.style.left) + 18;
  fireEvent.pointerDown(last, { button: 0, clientX: x, clientY: 40 });
  fireEvent.pointerUp(last, { clientX: x, clientY: 40 });
  expect(s().annotationUndoLane.length).toBe(lane);
});

it('[EDIT-81] offers each verb where its verb acts: Merge for two or more selected zones, Flip for any selected measurement', () => {
  /** The row's verbs over `selection`, rendered afresh so no leaving row stands beside it. */
  const verbsOver = (selection: string[]) => {
    cleanup();
    s().setAnnotationSelection(selection);
    render(<I18nProvider><AnnotationEditor /></I18nProvider>);
    return screen.queryAllByRole('button').map((b) => b.textContent).filter((text) => ['Merge', 'Flip', 'Delete'].includes(text ?? ''));
  };
  s().addAnnotation({ kind: 'zone', id: 'a', color: '#FFB347', cells: [{ x: 2, y: 8 }], tag: null, num: 1 });
  s().addAnnotation({ kind: 'zone', id: 'b', color: '#FFB347', cells: [{ x: 6, y: 8 }], tag: null, num: 2 });
  expect(verbsOver(['m'])).toEqual(['Flip', 'Delete']);
  expect(verbsOver(['a'])).toEqual(['Delete']);
  expect(verbsOver(['a', 'b'])).toEqual(['Merge', 'Delete']);
  expect(verbsOver(['a', 'm', 'b'])).toEqual(['Merge', 'Flip', 'Delete']);
  fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
  expect(note()).toMatchObject({ id: 'm', flipped: false });
  fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
  expect(s().gridState!.annotations!.items.map((n) => n.id)).toEqual(['m', 'a']);
  expect(s().annotationSelection).toEqual(['a']);
});

it('[EDIT-81] shows the verbs unavailable on a locked layer, where each is refused', () => {
  act(() => { s().setAnnotationsLocked(true); });
  const flip = screen.getByRole('button', { name: 'Flip' }) as HTMLButtonElement;
  expect(flip.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  expect(note()).toMatchObject({ id: 'm', flipped: true });
});
