/* Edits of the finished notes: a scripted edit on the Notes history lane under the layer's own rules,
 * and the door into editing them. */
import { HALVES, admitTagText, isEmptyNote, type CustomTag, type MapAnnotation, type MeasureNote, type NoteTag } from '../../core/model/annotations';
import { resizeMeasurementOn } from '../../core/model/annotation/dimensions';
import type { GridState, MacroCoord } from '../../core/model/types';
import { SELECTABLE_ANNOTATION_TAGS } from '../../config/annotation-tags';
import type { I18nKey } from '../../i18n/keys';
import { notesOpenable, type ModalId } from '../../state/slices/shell';
import { useEditorStore, type EditorStore } from '../../state/store';
import { recordTextVerdict, textApproved } from '../../state/text-verdicts';
import { editorCurves } from '../session/tool-wiring';

/** Arms annotate on the notes, showing them first if hidden; `close` names a window to close first.
 *  Does nothing while Notes cannot be opened (`notesOpenable`). */
export function showNotesForEditing(options: { close?: ModalId } = {}): void {
  const s = useEditorStore.getState();
  if (!notesOpenable(s)) return;
  if (options.close) s.setModal(options.close, false);
  s.setAnnotationsVisible(true);
  s.setEditMode({ mode: 'annotate' });
}

/** The finished notes and the map's custom tags, as a scripted edit reads and returns them. */
interface NoteSet {
  items: MapAnnotation[];
  customTags: CustomTag[];
}

/**
 * Applies `edit` to the notes and custom tags of `gridState` as one Notes stroke, keeping only the
 * selected notes that survive it. Refused (false) when the map has since been replaced or the layer
 * is locked or hidden.
 */
export function editAnnotationsOn(gridState: GridState, edit: (notes: NoteSet) => NoteSet): boolean {
  const s = useEditorStore.getState();
  if (s.gridState !== gridState || gridState.annotations?.locked || gridState.annotations?.visible === false) return false;
  s.beginAnnotationStroke();
  s.applyAnnotationEdit((data) => {
    const next = edit({ items: data.items, customTags: data.customTags ?? [] });
    data.items = next.items;
    if (next.customTags.length) data.customTags = next.customTags;
    else delete data.customTags;
  });
  const ids = new Set(gridState.annotations?.items.map((n) => n.id));
  s.setAnnotationSelection(s.annotationSelection.filter((id) => ids.has(id)));
  return true;
}

/** Whether the notes layer is locked against edits. */
const notesLocked = (): boolean => useEditorStore.getState().gridState?.annotations?.locked === true;

/** What the verb row over the selected notes offers, as its verbs act. */
export interface NoteSelectionTarget {
  /** The selected notes, in the order they were picked. */
  ids: readonly string[];
  /** Merge is offered: two or more of them are zones, which fold into the first picked; the other
   *  notes stay as they are and leave the selection. */
  mergeable: boolean;
  /** Flip is offered: one or more of them is a measurement; the other notes stay as they are. */
  flippable: boolean;
  /** Delete is offered: it takes every one of them. */
  deletable: boolean;
  /** The layer is locked, so the row shows its verbs and every one of them is refused. */
  locked: boolean;
}

/** The offers on the notes selected on the live map, or null where none is selected or the layer is
 *  hidden. */
export function noteSelectionTarget(s: Pick<EditorStore, 'gridState' | 'annotationSelection'>): NoteSelectionTarget | null {
  const notes = s.gridState?.annotations;
  if (!notes?.visible) return null;
  const picked = s.annotationSelection.map((id) => notes.items.find((n) => n.id === id)).filter((n): n is MapAnnotation => !!n);
  if (picked.length === 0) return null;
  return {
    ids: picked.map((n) => n.id),
    mergeable: picked.filter((n) => n.kind === 'zone').length > 1,
    flippable: picked.some((n) => n.kind === 'measure'),
    deletable: true,
    locked: notes.locked === true,
  };
}

/** Whether the note being drawn waits for Done: a zone or a route with something to keep. A
 *  measurement ends at its own second press. */
export function draftAwaitsDone(draft: MapAnnotation | null): boolean {
  return draft !== null && draft.kind !== 'measure' && !isEmptyNote(draft);
}

/** Throws away the note being drawn, and the curve it was drawn along. */
export function discardDraft(): void {
  editorCurves.end();
  useEditorStore.getState().discardAnnotationDraft();
}

/** Removes the notes `ids`, unless the layer is locked; an open curve ends with them. */
export function removeNotes(ids: string[]): void {
  if (notesLocked()) return;
  editorCurves.end();
  useEditorStore.getState().removeAnnotations(ids);
}

/** Merges the zones `ids` into one, unless the layer is locked. */
export function mergeZones(ids: string[]): void {
  if (notesLocked()) return;
  useEditorStore.getState().mergeAnnotationZones(ids);
}

/** Flips the measurements `ids` to their other side, unless the layer is locked. */
export function flipMeasures(ids: string[]): void {
  if (notesLocked()) return;
  useEditorStore.getState().flipMeasurements(ids);
}

/** Moves one end of the measurement `original` to `cell`, kept on the map; `begin` opens the stroke
 *  the move joins. Whether the measurement moved. */
function moveMeasureEnd(original: MeasureNote, endpoint: 0 | 1, cell: MacroCoord, begin: boolean): boolean {
  const s = useEditorStore.getState();
  const grid = s.gridState;
  if (!grid) return false;
  return s.setMeasurementPoints(original.id, resizeMeasurementOn(grid.template, original.points, endpoint, cell), begin);
}

/** The measurement `id` as the live map holds it now. */
function measureNote(id: string): MeasureNote | null {
  const note = useEditorStore.getState().gridState?.annotations?.items.find((n) => n.id === id);
  return note?.kind === 'measure' ? note : null;
}

/** One drag of a measurement's end. */
export interface MeasureEndDrag {
  /** Moves the end to `cell`, measured from the note as it stood when the drag began. False once the
   *  drag is over: the note changed under it, left the selection, or the layer was locked. */
  to(cell: MacroCoord): boolean;
  /** Ends the drag; a later `to` moves nothing. */
  end(): void;
}

/**
 * Starts a drag of end `endpoint` of the measurement `noteId`; null where there is no such
 * measurement. The whole drag is one step of the Notes history, opened by its first move that
 * changes the note, and it ends itself when anything but its own moves changed the note.
 */
export function measureEndDrag(noteId: string, endpoint: 0 | 1): MeasureEndDrag | null {
  const original = measureNote(noteId);
  if (!original) return null;
  let expected: MeasureNote | null = original;
  let began = false;
  return {
    to(cell) {
      if (!expected) return false;
      const s = useEditorStore.getState();
      if (measureNote(noteId) !== expected || !s.annotationSelection.includes(noteId) || notesLocked()) {
        expected = null;
        return false;
      }
      if (moveMeasureEnd(original, endpoint, cell, !began)) {
        began = true;
        expected = measureNote(noteId);
      }
      return true;
    },
    end() { expected = null; },
  };
}

/** Steps end `endpoint` of the measurement `noteId` by (`dx`, `dy`) note steps, half a cell each, as
 *  one step of the Notes history. Whether the measurement moved. */
export function nudgeMeasureEnd(noteId: string, endpoint: 0 | 1, dx: number, dy: number): boolean {
  const note = measureNote(noteId);
  if (!note) return false;
  const at = note.points[endpoint];
  return moveMeasureEnd(note, endpoint, { x: at.x + dx / HALVES, y: at.y + dy / HALVES }, true);
}

/**
 * A tag the visitor named, after its text check approved it: a name the row already shows (a preset
 * by its label, an approved custom tag, either case-insensitively) arms that tag; any other joins
 * the map's custom tags, approved wherever the map goes this session. Returns the tag it armed, null
 * where the name is blank or the map holds as many tags of its own as it can.
 */
export function addOrArmTag(typed: string, presetLabel: (key: I18nKey) => string, custom: readonly CustomTag[]): NoteTag | null {
  const store = useEditorStore.getState();
  const name = admitTagText(typed);
  if (!name) return null;
  const same = (label: string) => label.toLocaleLowerCase() === name.toLocaleLowerCase();
  const preset = SELECTABLE_ANNOTATION_TAGS.find((entry) => same(presetLabel(entry.labelKey)));
  const existing = custom.find((entry) => textApproved(entry.text) && same(entry.text));
  const id = preset?.id ?? existing?.id;
  if (id) {
    if (store.annotationTag !== id) store.setAnnotationTag(id);
    return id;
  }
  recordTextVerdict(name, true);
  return store.addCustomTag(name);
}
