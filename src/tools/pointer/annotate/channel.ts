import type { AnnotationsState, MapAnnotation, NoteTag } from '../../../core/model/annotations';
import type { ToolContext } from '../runtime/types';
import type { CurveChannel } from '../paint/curve-session';

/** The annotation slice's verbs, one handle for every note edit a gesture makes. */
export interface AnnotationEditVerbs {
  /** One lane entry for the gesture about to apply, however many `apply` calls follow. */
  begin(): void;
  apply(fn: (data: AnnotationsState) => void): void;
  add(a: MapAnnotation): void;
  remove(id: string): void;
  select(ids: string[]): void;
  setDraft(a: MapAnnotation | null): void;
  /** Turn the standing draft into a note; false when nothing commits. */
  commitDraft(): boolean;
}

/** What the annotate tool reads from its host beyond the base contract. */
export interface AnnotationChannels {
  annotationEdit: AnnotationEditVerbs;
  /** The drawn label for a tag, in the interface language. Hit tests read caption widths from it. */
  tagLabel: (tag: NoteTag) => string;
}

/** The context the annotate tool and its gestures run with. */
export type AnnotateContext = ToolContext & AnnotationChannels & CurveChannel;
