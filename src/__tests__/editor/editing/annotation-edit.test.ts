import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { flipMeasures, measureEndDrag, mergeZones, nudgeMeasureEnd, removeNotes, showNotesForEditing } from '../../../editor/editing/annotation-edit';
import type { MeasureNote } from '../../../core/model/annotations';
import { makeTemplate } from '../../_support/map-state';
import { resetStore, setStoreModal } from '../../_support/store';

const s = () => useEditorStore.getState();

describe('showNotesForEditing', () => {
  beforeEach(() => {
    resetStore();
    s().initMap(makeTemplate(10, 10), createDefaultRegistry());
  });

  it('shows hidden notes and arms annotate', () => {
    s().setAnnotationsVisible(false);
    showNotesForEditing();
    expect(s().gridState!.annotations!.visible).toBe(true);
    expect(s().editMode.mode).toBe('annotate');
  });

  it('closes the window it is asked to close first', () => {
    setStoreModal('share');
    showNotesForEditing({ close: 'share' });
    expect(s().modals.share).toBe(false);
    expect(s().editMode.mode).toBe('annotate');
  });
});

describe('the notes lock', () => {
  const measure = (): MeasureNote => s().gridState!.annotations!.items.find((n) => n.id === 'm') as MeasureNote;
  beforeEach(() => {
    resetStore();
    s().initMap(makeTemplate(20, 20), createDefaultRegistry());
    s().addAnnotation({ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 2, y: 4 }, { x: 8, y: 4 }] });
    s().setAnnotationsLocked(true);
  });

  it('refuses every notes verb on a locked layer, a measurement end move among them', () => {
    const before = JSON.stringify(s().gridState!.annotations!.items);
    const lane = s().annotationUndoLane.length;
    expect(nudgeMeasureEnd('m', 1, 1, 0)).toBe(false);
    expect(measureEndDrag('m', 1)!.to({ x: 12, y: 4 }), 'the drag is over at its first move').toBe(false);
    flipMeasures(['m']);
    mergeZones(['m']);
    removeNotes(['m']);
    expect(JSON.stringify(s().gridState!.annotations!.items)).toBe(before);
    expect(s().annotationUndoLane.length).toBe(lane);
  });

  it('moves the end once the layer is unlocked', () => {
    s().setAnnotationsLocked(false);
    s().setAnnotationSelection(['m']);
    expect(measureEndDrag('m', 1)!.to({ x: 12, y: 4 })).toBe(true);
    expect(measure().points).toEqual([{ x: 2, y: 4 }, { x: 12, y: 4 }]);
  });
});

describe('a measurement end', () => {
  const measure = (): MeasureNote => s().gridState!.annotations!.items.find((n) => n.id === 'm') as MeasureNote;
  const lane = (): number => s().annotationUndoLane.length;
  beforeEach(() => {
    resetStore();
    s().initMap(makeTemplate(20, 20), createDefaultRegistry());
    s().setEditMode({ mode: 'annotate' });
    s().addAnnotation({ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 2, y: 4 }, { x: 8, y: 4 }] });
    s().setAnnotationSelection(['m']);
  });

  it('is dragged as one undo step however many moves the drag makes, each measured from where it began', () => {
    const original = measure();
    const before = lane();
    const drag = measureEndDrag('m', 1)!;
    expect(drag.to({ x: 8, y: 4 }), 'a move to where the end stands opens no step').toBe(true);
    expect(lane()).toBe(before);
    expect(drag.to({ x: 11, y: 9 })).toBe(true);
    expect(measure().points).toEqual([{ x: 2, y: 4 }, { x: 11, y: 4 }]);
    expect(drag.to({ x: 15, y: 4 })).toBe(true);
    drag.end();
    expect(measure().points).toEqual([{ x: 2, y: 4 }, { x: 15, y: 4 }]);
    expect(lane()).toBe(before + 1);
    s().undoAnnotation();
    expect(measure()).toEqual(original);
  });

  it('stops following a drag once the note changed under it, left the selection or the drag ended', () => {
    const changed = measureEndDrag('m', 1)!;
    changed.to({ x: 11, y: 4 });
    s().undoAnnotation();
    expect(changed.to({ x: 15, y: 4 })).toBe(false);
    expect(changed.to({ x: 16, y: 4 }), 'it stays over').toBe(false);
    expect(measure().points).toEqual([{ x: 2, y: 4 }, { x: 8, y: 4 }]);

    s().setAnnotationSelection(['m']);
    const deselected = measureEndDrag('m', 1)!;
    s().setAnnotationSelection([]);
    expect(deselected.to({ x: 15, y: 4 })).toBe(false);

    s().setAnnotationSelection(['m']);
    const ended = measureEndDrag('m', 0)!;
    ended.end();
    expect(ended.to({ x: 0, y: 4 })).toBe(false);
    expect(measure().points).toEqual([{ x: 2, y: 4 }, { x: 8, y: 4 }]);
  });

  it('steps half a cell per nudge, each its own undo step, and stays on the map', () => {
    const before = lane();
    expect(nudgeMeasureEnd('m', 1, 1, 0)).toBe(true);
    expect(nudgeMeasureEnd('m', 1, 1, 0)).toBe(true);
    expect(measure().points).toEqual([{ x: 2, y: 4 }, { x: 9, y: 4 }]);
    expect(lane()).toBe(before + 2);
    expect(nudgeMeasureEnd('m', 0, -100, 0)).toBe(true);
    expect(measure().points[0]).toEqual({ x: 0, y: 4 });
    expect(nudgeMeasureEnd('m', 0, -1, 0), 'no further than the map\'s edge').toBe(false);
  });

  it('answers nothing for a note that is no measurement', () => {
    expect(measureEndDrag('none', 0)).toBeNull();
    expect(nudgeMeasureEnd('none', 0, 1, 0)).toBe(false);
  });
});
