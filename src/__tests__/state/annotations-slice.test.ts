/**
 * The annotation slice: the data lives on `gridState.annotations` and every mutation goes through
 * the slice's verbs, which bump the epoch and keep the layer's own undo/redo lanes. A gesture is
 * One lane entry however many edits it applies, and a new or loaded map resets the session (lanes,
 * selection, draft) without carrying the previous map's history over.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeTemplate } from '../_support/map-state';
import type { CustomTagId, ZoneNote } from '../../core/model/annotations';
import type { EditorStore } from '../../state/store';

const zone = (id: string, num = 1): ZoneNote => ({
  kind: 'zone', id, cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], color: '#FF8A7A', tag: 'homes', num,
});

describe('annotation slice', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(makeTemplate(10, 10), createDefaultRegistry());
  });

  it('flips selected measurements together as one reversible edit and respects the layer lock', () => {
    const s = () => useEditorStore.getState();
    for (const id of ['a', 'b']) s().addAnnotation({ kind: 'measure', id, points: [{ x: 1, y: 1 }, { x: 8, y: 1 }], color: '#FFB347' });
    const original = JSON.stringify(s().gridState!.annotations!.items);
    const before = s().annotationUndoLane.length;
    s().flipMeasurements(['a', 'b']);
    expect(s().annotationUndoLane).toHaveLength(before + 1);
    for (const note of s().gridState!.annotations!.items) expect(note).toMatchObject({ flipped: true });
    s().undoAnnotation(); expect(JSON.stringify(s().gridState!.annotations!.items)).toBe(original);
    s().redoAnnotation();
    s().setAnnotationsLocked(true);
    s().flipMeasurements(['a']);
    expect(s().annotationUndoLane).toHaveLength(before + 1);
    expect(s().gridState!.annotations!.items[0]).toMatchObject({ flipped: true });
    s().setAnnotationsLocked(false); s().flipMeasurements(['a']);
    expect(s().gridState!.annotations!.items[0]).toMatchObject({ flipped: false });
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


describe('unfinished annotation transitions', () => {
  const s = () => useEditorStore.getState();
  beforeEach(() => {
    s().initMap(makeTemplate(20, 20), createDefaultRegistry());
    s().setEditMode({ mode: 'annotate' }); s().setAnnotationTool('zone');
  });

  it('keeps a draft through brush and eraser switches and asks before leaving Notes', () => {
    s().setAnnotationDraft(zone('draft'));
    s().setAnnotationTool('erase'); s().setAnnotationTool('zone');
    expect(s().annotationDiscardAction).toBeNull();
    s().setEditMode({ mode: 'mountain' });
    expect(s().editMode.mode).toBe('annotate');
    expect(s().annotationDraft).toEqual(zone('draft'));
    s().cancelAnnotationDiscard();
    expect(s().editMode.mode).toBe('annotate');
    s().setEditMode({ mode: 'mountain' }); s().confirmAnnotationDiscard();
    expect(s().editMode.mode).toBe('mountain');
    expect(s().annotationDraft).toBeNull();
  });

  it('discards draft history while retaining reversible edits to finished notes', () => {
    s().addAnnotation(zone('kept'));
    s().beginAnnotationStroke(); s().setAnnotationDraft(zone('draft'));
    s().setAnnotationTag(null);
    expect(s().annotationDraft).toMatchObject({ tag: null });
    s().discardAnnotationDraft();
    expect(s().annotationUndoLane).toHaveLength(1);
    s().undoAnnotation(); expect(s().gridState!.annotations!.items).toEqual([]);
    s().redoAnnotation(); expect(s().gridState!.annotations!.items).toEqual([zone('kept')]);
    expect(s().annotationDraft).toBeNull();
  });

  it('saves an untagged draft before switching tools and preserves undo and redo', () => {
    const draft = { ...zone('draft'), tag: null };
    s().addAnnotation(zone('kept'));
    s().beginAnnotationStroke(); s().setAnnotationDraft(draft);
    s().setAnnotationTool('route');
    s().confirmAnnotationSave();
    expect(s().annotationTool).toBe('route');
    expect(s().annotationDiscardAction).toBeNull();
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState!.annotations!.items).toEqual([zone('kept'), draft]);
    s().confirmAnnotationSave();
    expect(s().gridState!.annotations!.items).toHaveLength(2);
    expect(s().undoAnnotation()).toBe(true);
    expect(s().annotationDraft).toEqual(draft);
    expect(s().gridState!.annotations!.items).toEqual([zone('kept')]);
    expect(s().redoAnnotation()).toBe(true);
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState!.annotations!.items).toEqual([zone('kept'), draft]);
  });

  it('saves an unfinished route before leaving Notes', () => {
    s().setAnnotationTool('route');
    const draft = { kind: 'route' as const, id: 'route', points: [{ x: 2, y: 2 }, { x: 5, y: 4 }], color: '#FF8A7A', dashed: true };
    s().setAnnotationDraft(draft);
    s().setEditMode({ mode: 'mountain' });
    s().confirmAnnotationSave();
    expect(s().editMode.mode).toBe('mountain');
    expect(s().annotationDiscardAction).toBeNull();
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState!.annotations!.items).toEqual([draft]);
  });

  it('continues without creating an annotation when the draft has no cells', () => {
    s().setAnnotationDraft({ ...zone('empty'), cells: [] });
    s().setAnnotationTool('route');
    s().confirmAnnotationSave();
    expect(s().annotationTool).toBe('route');
    expect(s().annotationDiscardAction).toBeNull();
    expect(s().annotationDraft).toBeNull();
    expect(s().gridState!.annotations!.items).toEqual([]);
  });

  it('cancels a pending transition when a new map is installed', () => {
    s().setAnnotationDraft(zone('draft')); s().setAnnotationTool('route');
    s().initMap(makeTemplate(10, 10), createDefaultRegistry());
    s().confirmAnnotationDiscard();
    s().confirmAnnotationSave();
    expect(s().annotationTool).toBe('zone');
    expect(s().annotationDiscardAction).toBeNull();
    expect(s().gridState?.annotations?.items ?? []).toEqual([]);
  });

  describe('each verb publishes one consistent update', () => {
    const s = () => useEditorStore.getState();
    function published(body: () => void): EditorStore[] {
      const seen: EditorStore[] = [];
      const stop = useEditorStore.subscribe((state) => { seen.push(state); });
      body();
      stop();
      return seen;
    }

    it('commits a draft with the note in the items and selected', () => {
      s().setAnnotationDraft(zone('a'));
      const seen = published(() => { s().commitAnnotationDraft(); });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.annotationDraft).toBeNull();
      expect(seen[0]!.annotationSelection).toEqual(['a']);
      expect(s().gridState!.annotations!.items.map((n) => n.id)).toEqual(['a']);
      expect(s().undoAnnotation()).toBe(true);
      expect(s().annotationDraft).toMatchObject({ id: 'a' });
    });

    it('applies an armed colour to the selection', () => {
      s().addAnnotation(zone('a'));
      s().setAnnotationSelection(['a']);
      const lane = s().annotationUndoLane.length;
      const seen = published(() => { s().setAnnotationColor('#000000'); });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.annotationColor).toBe('#000000');
      expect(s().gridState!.annotations!.items[0]).toMatchObject({ color: '#000000' });
      expect(s().annotationUndoLane).toHaveLength(lane + 1);
    });

    it('adds and removes a custom tag', () => {
      s().addAnnotation(zone('a'));
      s().setAnnotationSelection(['a']);
      const lane = s().annotationUndoLane.length;
      let id: CustomTagId | null = null;
      expect(published(() => { id = s().addCustomTag('Orchard'); })).toHaveLength(1);
      expect(s().annotationTag).toBe(id);
      expect(s().gridState!.annotations!.items[0]).toMatchObject({ tag: id });
      expect(s().annotationUndoLane).toHaveLength(lane + 1);
      expect(published(() => { s().removeCustomTag(id!); })).toHaveLength(1);
      expect(s().gridState!.annotations!.customTags ?? []).toEqual([]);
      expect(s().annotationUndoLane).toHaveLength(lane + 2);
    });
  });
});
