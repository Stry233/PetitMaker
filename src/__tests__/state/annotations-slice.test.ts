/**
 * The annotation slice: the data lives on `gridState.annotations` and every mutation goes through
 * the slice's verbs, which bump the epoch and keep the layer's own undo/redo lanes. A gesture is
 * ONE lane entry however many edits it applies, and a new or loaded map resets the session (lanes,
 * selection, draft) without carrying the previous map's history over.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeTemplate } from '../rules/_helpers';
import type { ZoneNote } from '../../core/model/annotations';

const zone = (id: string, num = 1): ZoneNote => ({
  kind: 'zone', id, cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], color: '#FF8A7A', tag: 'homes', num,
});

describe('annotation slice', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(makeTemplate(10, 10), createDefaultRegistry());
  });

  it('add, update and remove mutate the grid data and bump the epoch', () => {
    const s = () => useEditorStore.getState();
    const before = s().annotationsEpoch;
    s().addAnnotation(zone('a'));
    expect(s().gridState?.annotations?.items).toHaveLength(1);
    expect(s().annotationsEpoch).toBe(before + 1);
    s().updateAnnotation('a', { tag: 'farm' });
    expect(s().gridState?.annotations?.items[0]).toMatchObject({ tag: 'farm' });
    s().removeAnnotation('a');
    expect(s().gridState?.annotations?.items).toHaveLength(0);
  });

  it('a gesture is one undo entry: begin once, apply many, undo restores the start', () => {
    const s = () => useEditorStore.getState();
    s().addAnnotation(zone('a'));
    s().beginAnnotationStroke();
    s().applyAnnotationEdit((d) => { (d.items[0] as ZoneNote).cells.push({ x: 3, y: 1 }); });
    s().applyAnnotationEdit((d) => { (d.items[0] as ZoneNote).cells.push({ x: 4, y: 1 }); });
    expect((s().gridState?.annotations?.items[0] as ZoneNote).cells).toHaveLength(4);
    expect(s().undoAnnotation()).toBe(true);
    expect((s().gridState?.annotations?.items[0] as ZoneNote).cells).toHaveLength(2);
    expect(s().undoAnnotation()).toBe(true);
    expect(s().gridState?.annotations?.items).toHaveLength(0);
    expect(s().undoAnnotation()).toBe(false);
  });

  it('redo replays what undo took back, and a new stroke clears the redo lane', () => {
    const s = () => useEditorStore.getState();
    s().addAnnotation(zone('a'));
    s().undoAnnotation();
    expect(s().gridState?.annotations?.items).toHaveLength(0);
    expect(s().redoAnnotation()).toBe(true);
    expect(s().gridState?.annotations?.items).toHaveLength(1);
    s().addAnnotation(zone('b', 2));
    expect(s().redoAnnotation()).toBe(false);
  });

  it('removing the selected note clears the selection', () => {
    const s = () => useEditorStore.getState();
    s().addAnnotation(zone('a'));
    s().setAnnotationSelection(['a']);
    s().removeAnnotation('a');
    expect(s().annotationSelection).toEqual([]);
  });

  it('eye and lock write the grid data without joining the undo lanes', () => {
    const s = () => useEditorStore.getState();
    s().setAnnotationsVisible(false);
    s().setAnnotationsLocked(true);
    expect(s().gridState?.annotations).toMatchObject({ visible: false, locked: true });
    expect(s().undoAnnotation()).toBe(false);
  });

  it('an armed tag, color or size reaches the draft and the selection; the selection as one lane entry', () => {
    const s = () => useEditorStore.getState();
    s().addAnnotation(zone('a'));
    s().addAnnotation({ ...zone('b', 2), id: 'b' });
    s().setAnnotationDraft(zone('draft', 9));
    s().setAnnotationSelection(['a']);
    const lanes = s().annotationUndoLane.length;
    s().setAnnotationTag('forest');
    s().setAnnotationColor('#3B82F6');
    expect(s().annotationDraft).toMatchObject({ tag: 'forest', color: '#3B82F6' });
    const items = s().gridState!.annotations!.items as ZoneNote[];
    expect(items.find((n) => n.id === 'a')).toMatchObject({ tag: 'forest', color: '#3B82F6' });
    expect(items.find((n) => n.id === 'b')).toMatchObject({ tag: 'homes', color: '#FF8A7A' });
    expect(s().annotationUndoLane.length).toBe(lanes + 2);
  });

  it('committing the draft makes it a selected note; an empty draft commits nothing', () => {
    const s = () => useEditorStore.getState();
    s().setAnnotationDraft({ ...zone('d', 3), cells: [] });
    expect(s().commitAnnotationDraft()).toBe(false);
    expect(s().gridState?.annotations?.items ?? []).toHaveLength(0);
    s().setAnnotationDraft(zone('d', 3));
    expect(s().commitAnnotationDraft()).toBe(true);
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState?.annotations?.items).toHaveLength(1);
    expect(s().annotationSelection).toEqual(['d']);
  });

  it('a new map resets the session: lanes, selection and draft go, the epoch moves', () => {
    const s = () => useEditorStore.getState();
    s().addAnnotation(zone('a'));
    s().setAnnotationSelection(['a']);
    s().setAnnotationDraft(zone('draft', 9));
    const epoch = s().annotationsEpoch;
    s().initMap(makeTemplate(8, 8), createDefaultRegistry());
    expect(s().annotationUndoLane).toHaveLength(0);
    expect(s().annotationSelection).toEqual([]);
    expect(s().annotationDraft).toBeNull();
    expect(s().annotationsEpoch).toBeGreaterThan(epoch);
    expect(s().gridState?.annotations?.items ?? []).toHaveLength(0);
  });
});

describe('the selection set and its batch verbs', () => {
  const zoneAt = (id: string, x: number): any => ({
    kind: 'zone', id, cells: [{ x, y: 2 }, { x: x + 1, y: 2 }], color: '#FF8A7A', tag: 'homes', num: 1,
  });

  it('removeAnnotations takes the whole set as ONE lane entry', () => {
    const s = () => useEditorStore.getState();
    s().initMap(makeTemplate(12, 12), createDefaultRegistry());
    s().addAnnotation(zoneAt('a', 1));
    s().addAnnotation(zoneAt('b', 4));
    s().setAnnotationSelection(['a', 'b']);
    const lanes = s().annotationUndoLane.length;
    s().removeAnnotations(['a', 'b']);
    expect(s().gridState?.annotations?.items).toHaveLength(0);
    expect(s().annotationSelection).toEqual([]);
    expect(s().annotationUndoLane.length).toBe(lanes + 1);
    s().undoAnnotation();
    expect(s().gridState?.annotations?.items).toHaveLength(2);
  });

  it('merge folds the cells into the FIRST zone and keeps its identity', () => {
    const s = () => useEditorStore.getState();
    s().initMap(makeTemplate(12, 12), createDefaultRegistry());
    s().addAnnotation({ ...zoneAt('a', 1), tag: 'homes', num: 1, color: '#FF8A7A' });
    s().addAnnotation({ ...zoneAt('b', 4), tag: 'farm', num: 2, color: '#3B82F6' });
    // A shared cell dedups rather than doubling.
    s().addAnnotation({ kind: 'zone', id: 'c', cells: [{ x: 4, y: 2 }, { x: 6, y: 2 }], color: '#9BC53D', tag: 'shops', num: 3 } as any);
    s().mergeAnnotationZones(['a', 'b', 'c']);
    const items = s().gridState!.annotations!.items;
    expect(items).toHaveLength(1);
    const z = items[0] as any;
    expect(z.id).toBe('a');
    expect(z.tag).toBe('homes');
    expect(z.num).toBe(1);
    expect(z.color).toBe('#FF8A7A');
    expect(z.cells).toHaveLength(5);
    expect(s().annotationSelection).toEqual(['a']);
    // One lane entry for the whole merge: one undo puts all three back.
    s().undoAnnotation();
    expect(s().gridState!.annotations!.items).toHaveLength(3);
  });

  it('merge asks for at least two zones and ignores everything else', () => {
    const s = () => useEditorStore.getState();
    s().initMap(makeTemplate(12, 12), createDefaultRegistry());
    s().addAnnotation(zoneAt('a', 1));
    s().addAnnotation({ kind: 'chip', id: 't', x: 5, y: 5, tag: 'plaza', size: 'm', color: '#FFB347' } as any);
    const lanes = s().annotationUndoLane.length;
    s().mergeAnnotationZones(['a', 't']);
    expect(s().gridState!.annotations!.items).toHaveLength(2);
    expect(s().annotationUndoLane.length).toBe(lanes);
  });
});
