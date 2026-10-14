/* Edits of the finished notes: a scripted edit on the Notes history lane under the layer's own rules,
 * and the door into editing them. */
import type { CustomTag, MapAnnotation, MeasureNote } from '../../core/model/annotations';
import { resizeMeasurement } from '../../core/model/annotation/dimensions';
import type { GridState, MacroCoord } from '../../core/model/types';
import { SELECTABLE_ANNOTATION_TAGS } from '../../config/annotation-tags';
import type { I18nKey } from '../../i18n/keys';
import type { ModalId } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import { recordTextVerdict, textApproved } from '../../state/text-verdicts';
import { editorCurves } from '../session/tool-wiring';

/** Arms annotate on the notes, showing them first if hidden; `close` names a window to close first. */
export function showNotesForEditing(options: { close?: ModalId } = {}): void {
  const s = useEditorStore.getState();
  if (options.close) s.setModal(options.close, false);
  s.setAnnotationsVisible(true);
  s.setEditMode({ mode: 'annotate' });
}

/**
 * Applies `edit` to the notes of `gridState` as one Notes stroke, keeping only the selected notes
 * that survive it. Refused (false) when the map has since been replaced or the layer is locked or hidden.
 */
export function editAnnotationsOn(
  gridState: GridState, edit: (items: MapAnnotation[]) => MapAnnotation[],
): boolean {
  const s = useEditorStore.getState();
  if (s.gridState !== gridState || gridState.annotations?.locked || gridState.annotations?.visible === false) return false;
  s.beginAnnotationStroke();
  s.applyAnnotationEdit((data) => { data.items = edit(data.items); });
  const ids = new Set(gridState.annotations?.items.map((n) => n.id));
  s.setAnnotationSelection(s.annotationSelection.filter((id) => ids.has(id)));
  return true;
}

/** Whether the notes layer is locked against edits. */
const notesLocked = (): boolean => useEditorStore.getState().gridState?.annotations?.locked === true;

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

/**
 * Moves one end of the measurement `original` to `cell`, kept on the map; `begin` opens the stroke
 * the move joins. Whether the measurement moved.
 */
export function moveMeasureEnd(original: MeasureNote, endpoint: 0 | 1, cell: MacroCoord, begin: boolean): boolean {
  const s = useEditorStore.getState();
  const grid = s.gridState;
  if (!grid) return false;
  const points = resizeMeasurement(original.points, endpoint, {
    x: Math.max(0, Math.min(grid.template.width - 1, cell.x)),
    y: Math.max(0, Math.min(grid.template.height - 1, cell.y)),
  });
  return s.setMeasurementPoints(original.id, points, begin);
}

/**
 * A tag the visitor named, after its text check approved it: a name the row already shows (a preset
 * by its label, an approved custom tag, either case-insensitively) arms that tag; any other joins
 * the map's custom tags, approved wherever the map goes this session.
 */
export function addOrArmTag(name: string, presetLabel: (key: I18nKey) => string, custom: readonly CustomTag[]): void {
  const store = useEditorStore.getState();
  const same = (label: string) => label.toLocaleLowerCase() === name.toLocaleLowerCase();
  const preset = SELECTABLE_ANNOTATION_TAGS.find((entry) => same(presetLabel(entry.labelKey)));
  const existing = custom.find((entry) => textApproved(entry.text) && same(entry.text));
  const id = preset?.id ?? existing?.id;
  if (id) {
    if (store.annotationTag !== id) store.setAnnotationTag(id);
    return;
  }
  recordTextVerdict(name, true);
  store.addCustomTag(name);
}
