/**
 * The plan notes' undo lane and the checked edits of finished notes, over any notes holder: the
 * store's notes slice runs them on the live map, the Help sandbox on its own. Entries are JSON
 * snapshots of the items, the custom tags and the draft, newest last (`history-lane.ts`).
 */
import { laneRecord, laneStep, type HistoryLane } from './history-lane';
import {
  flipMeasures, isMeasureSpan, type AnnotationsState, type CustomTag, type MapAnnotation, type MeasureNote,
} from '../core/model/annotations';
import type { AnnotationTool } from './editing/vocabulary';
import type { MacroCoord } from '../core/model/types';

export type NoteLane = HistoryLane<string>;

export interface NoteSnapshot {
  items: MapAnnotation[];
  /** Absent in an entry with no custom tags. */
  customTags?: CustomTag[];
  draft: MapAnnotation | null;
}

/** What a lane entry restores besides the draft. */
export function keptNotes(d: Pick<AnnotationsState, 'items' | 'customTags'>): Omit<NoteSnapshot, 'draft'> {
  return { items: d.items, ...(d.customTags?.length ? { customTags: d.customTags } : {}) };
}

function noteSnapshot(d: Pick<AnnotationsState, 'items' | 'customTags'>, draft: MapAnnotation | null): string {
  return JSON.stringify({ ...keptNotes(d), draft });
}

/** `lane` with `d` and `draft` recorded as they stand before a gesture's first edit. */
export function recordNotes(lane: NoteLane, d: Pick<AnnotationsState, 'items' | 'customTags'>, draft: MapAnnotation | null): NoteLane {
  return laneRecord(lane, noteSnapshot(d, draft));
}

/** One step back or forward: `d`'s items and custom tags restored in place, and the lane and draft
 *  after the step. Null when that side of the lane is empty. */
export function stepNotes(
  lane: NoteLane, d: AnnotationsState, draft: MapAnnotation | null, dir: 'undo' | 'redo',
): { lane: NoteLane; draft: MapAnnotation | null } | null {
  const step = laneStep(lane, noteSnapshot(d, draft), dir);
  if (!step) return null;
  const restored = JSON.parse(step.restored) as NoteSnapshot;
  d.items = restored.items;
  if (restored.customTags?.length) d.customTags = restored.customTags;
  else delete d.customTags;
  return { lane: step.lane, draft: restored.draft };
}

/** The verb a restored draft hands back: its own kind, except that a zone draft keeps the eraser
 *  armed over it. */
export function toolForDraft(draft: MapAnnotation, current: AnnotationTool): AnnotationTool {
  return draft.kind === 'zone' && current === 'erase' ? 'erase' : draft.kind;
}

/** The measurement `id` of `d` spanning `points`, or null where the layer is hidden or locked, `id`
 *  is no measurement, the span is no measurement's or it is the one standing. */
export function repointedMeasure(d: AnnotationsState, id: string, points: [MacroCoord, MacroCoord]): MeasureNote | null {
  const note = d.items.find((n) => n.id === id);
  if (d.locked || !d.visible || note?.kind !== 'measure' || !isMeasureSpan(points)) return null;
  if (points.every((p, i) => p.x === note.points[i]!.x && p.y === note.points[i]!.y)) return null;
  return { ...note, points };
}

/** `d`'s items with the measurements among `ids` flipped, or null where the layer is hidden or
 *  locked or none of them is a measurement. */
export function flippedNotes(d: AnnotationsState, ids: readonly string[]): MapAnnotation[] | null {
  if (d.locked || !d.visible) return null;
  const selected = new Set(ids);
  if (!d.items.some((n) => n.kind === 'measure' && selected.has(n.id))) return null;
  return flipMeasures(d.items, selected);
}
