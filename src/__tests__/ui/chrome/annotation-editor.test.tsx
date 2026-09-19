import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { AnnotationEditor } from '../../../ui/chrome/floating/AnnotationEditor';
import { makeTemplate } from '../../rules/_helpers';

vi.mock('../../../canvas/active-view', () => ({
  getActiveView: () => ({ projection: {
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
    screenToHalf: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
  } }),
  onActiveViewChange: () => () => {},
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

it('supports keyboard resizing and clamps endpoints to the map', () => {
  const end = screen.getByRole('button', { name: 'Measurement endpoint 2' });
  fireEvent.keyDown(end, { key: 'ArrowRight' });
  expect(note()).toMatchObject({ points: [{ x: 2, y: 4 }, { x: 9, y: 4 }] });
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
