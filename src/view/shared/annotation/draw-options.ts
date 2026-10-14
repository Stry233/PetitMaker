import type { MapAnnotation, NoteTag } from '../../../core/model/annotations';
import type { GridState } from '../../../core/model/types';
import { tagLabel } from '../../../i18n/annotation-tags';
import { useEditorStore } from '../../../state/store';

/** What both annotation layers are told on every draw, beside each view's own options. */
export interface AnnotationDrawBase {
  draft: MapAnnotation | null;
  /** The selected notes' ids, marked in both views; omitted marks none. */
  selectionIds?: readonly string[];
  /** The drawn label for a tag, in the interface language. */
  tagLabel: (tag: NoteTag) => string;
  /** Whether a selected or drafted zone shows its width and height; omitted shows them. */
  zoneDimensions?: boolean;
}

/** A tag's label in the current interface language, with the custom tags of `state` or, by default, of the editor's map, both read when a label is drawn. */
export function noteTagLabel(state?: GridState): (tag: NoteTag) => string {
  return (tag) => {
    const s = useEditorStore.getState();
    return tagLabel(tag, s.locale, (state ?? s.gridState)?.annotations?.customTags);
  };
}

/** The editor's own annotation draw: its draft, selection and dimension switch as the store holds them now. */
export function editorAnnotationDraw(): Required<AnnotationDrawBase> {
  const s = useEditorStore.getState();
  return { draft: s.annotationDraft, selectionIds: s.annotationSelection, tagLabel: noteTagLabel(), zoneDimensions: s.annotationDimensions };
}
