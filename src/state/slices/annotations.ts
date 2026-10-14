/** Annotation data and drafts share gesture history, independently of terrain edits. */
import { laneRecord, laneStep, type HistoryLane } from '../history-lane';
import type { StateCreator } from 'zustand';
import { CUSTOM_TAG_MAX, annotationsOf, flipMeasures, generateCustomTagId, isEmptyNote, isMeasureSpan, keepCustomTags, mergeZones, withTag, withoutTagsOn, type AnnotationsState, type CustomTag, type CustomTagId, type MapAnnotation, type NoteTag, type ZoneTextSize } from '../../core/model/annotations';
import { ANNOTATION_COLORS } from '../../config/annotation-palette';
import { DEFAULT_TAG } from '../../config/annotation-tags';
import { type AnnotationTool } from '../editing/vocabulary';
import type { BuildShape } from '../editing/edit-mode';
import type { EngineSlice } from './engine';
import type { MacroCoord } from '../../core/model/types';

/** The notes' lane as the store holds it: snapshots as JSON text, newest last. */
const annotationLane = (s: Pick<AnnotationsSlice, 'annotationUndoLane' | 'annotationRedoLane'>): HistoryLane<string> =>
  ({ undo: s.annotationUndoLane, redo: s.annotationRedoLane });

export interface AnnotationsSlice {
  /** Bumped on every annotation data mutation; the freshness key views subscribe to. */
  annotationsEpoch: number;
  annotationTool: AnnotationTool;
  /** Which figure the zone cells lay (the terrain bar's own vocabulary). A property of the zone
   *  tool rather than an arming, so putting the tool down keeps the figure. */
  annotationZoneShape: BuildShape;
  annotationColor: string;
  /** The tag a new zone or chip carries, and the tag a pick applies to the selection. */
  annotationTag: NoteTag | null;
  /** Caption and chip size; 'none' draws a zone with no caption and leaves chips at their own. */
  annotationSize: ZoneTextSize;
  annotationRouteDashed: boolean;
  /** The width a new route takes, on the brush size slider's range; kept apart from the brush's
   *  size so a wide brush never makes a wide route. */
  annotationRouteWidth: number;
  /** Whether a selected or drafted zone shows its width and height. Session state, as the region
   *  selection's own Dimensions choice is. */
  annotationDimensions: boolean;
  /** The selected notes' ids, in the order they were picked — a set, like the map's own object
   *  selection: Ctrl-clicks toggle members, batch verbs (delete, merge) act on the whole. The
   *  First id is the primary: a merge keeps its identity. */
  annotationSelection: string[];
  /** Both views draw the unfinished note; Done moves it into the saved items. */
  annotationDraft: MapAnnotation | null;
  annotationHistoryEpoch: number;
  annotationDiscardAction: (() => void) | null;
  requestAnnotationDiscard: (action: () => void) => void;
  confirmAnnotationDiscard: () => void;
  confirmAnnotationSave: () => void;
  cancelAnnotationDiscard: () => void;
  discardAnnotationDraft: () => void;
  annotationUndoLane: string[];
  annotationRedoLane: string[];
  setAnnotationTool: (t: AnnotationTool) => void;
  toggleAnnotationTool: (t: Exclude<AnnotationTool, 'none'>) => void;
  setAnnotationZoneShape: (s: BuildShape) => void;
  /** Arm a color; a standing selection takes it too, as one lane entry. */
  setAnnotationColor: (c: string) => void;
  /** Arm a tag; a standing draft or selection takes it too. */
  setAnnotationTag: (tag: NoteTag | null) => void;
  /** Add `text` to the map's custom tags and arm it, applying it to the draft and selection, as one
   *  lane entry. The caller passes text the text check approved. Null when the map holds the most
   *  custom tags it can; a text the map already carries arms that tag. */
  addCustomTag: (text: string) => CustomTagId | null;
  /** Remove a custom tag as one lane entry: zones wearing it go untagged and chips wearing it go. */
  removeCustomTag: (id: CustomTagId) => void;
  setAnnotationSize: (s: ZoneTextSize) => void;
  setAnnotationRouteDashed: (d: boolean) => void;
  setAnnotationRouteWidth: (width: number) => void;
  setAnnotationDimensions: (visible: boolean) => void;
  setAnnotationSelection: (ids: string[]) => void;
  setAnnotationDraft: (a: MapAnnotation | null) => void;
  /** Turn the standing draft into a note, selected. False when nothing commits. */
  commitAnnotationDraft: () => boolean;
  /** Snapshot items and draft once before the first mutation of a gesture. */
  beginAnnotationStroke: () => void;
  /** Mutate the data in place and bump the epoch. No lane entry of its own: a caller that wants
   *  one opens the stroke first. */
  applyAnnotationEdit: (fn: (data: AnnotationsState) => void) => void;
  addAnnotation: (a: MapAnnotation) => void;
  removeAnnotation: (id: string) => void;
  /** Remove several notes as one undo-lane entry. */
  removeAnnotations: (ids: string[]) => void;
  /** Merge the given zones into the first of them: its tag, number, colour and size absorb the
   *  others' cells (deduplicated), and the absorbed zones go — one lane entry. Ids that are not
   *  zones are ignored; under two zones, nothing happens. */
  mergeAnnotationZones: (ids: string[]) => void;
  updateAnnotation: (id: string, patch: Partial<MapAnnotation>) => void;
  flipMeasurements: (ids: string[]) => void;
  setMeasurementPoints: (id: string, points: [MacroCoord, MacroCoord], beginStroke: boolean) => boolean;
  setAnnotationsVisible: (v: boolean) => void;
  setAnnotationsLocked: (v: boolean) => void;
  undoAnnotation: () => boolean;
  redoAnnotation: () => boolean;
}

type Deps = Pick<EngineSlice, 'gridState'>;

export const createAnnotationsSlice: StateCreator<AnnotationsSlice & Deps, [], [], AnnotationsSlice> = (set, get) => {
  const data = (): AnnotationsState | null => {
    const g = get().gridState;
    return g ? annotationsOf(g) : null;
  };
  const bump = () => set((s) => ({ annotationsEpoch: s.annotationsEpoch + 1 }));

  /** Step through annotation history: restore the newest snapshot on that side and move the
   *  standing notes to the other. False when there is nothing to restore. */
  function travel(dir: 'undo' | 'redo'): boolean {
    const d = data();
    const lane = annotationLane(get());
    if (!d || lane[dir].length === 0) return false;
    const step = laneStep(lane, snapshot(d, get().annotationDraft), dir)!;
    const restored = JSON.parse(step.restored) as AnnotationSnapshot;
    set((s) => ({
      annotationUndoLane: [...step.lane.undo],
      annotationRedoLane: [...step.lane.redo],
      annotationSelection: [],
      annotationDraft: restored.draft,
      ...(restored.draft ? { annotationTool: restored.draft.kind === 'zone' && s.annotationTool === 'erase' ? 'erase' as const : restored.draft.kind } : {}),
      annotationHistoryEpoch: s.annotationHistoryEpoch + 1,
    }));
    d.items = restored.items;
    if (restored.customTags?.length) d.customTags = restored.customTags;
    else delete d.customTags;
    bump();
    return true;
  }

  return {
    annotationsEpoch: 0,
    annotationTool: 'zone',
    annotationZoneShape: 'free',
    annotationColor: ANNOTATION_COLORS[0]!,
    annotationTag: DEFAULT_TAG,
    annotationSize: 'm',
    annotationRouteDashed: true,
    annotationRouteWidth: 1,
    annotationDimensions: true,
    annotationSelection: [],
    annotationDraft: null,
    annotationHistoryEpoch: 0,
    annotationDiscardAction: null,
    annotationUndoLane: [],
    annotationRedoLane: [],
    setAnnotationTool: (t) => {
      const s = get();
      if (s.annotationTool === t) return;
      const change = () => set({
        annotationTool: t, annotationSelection: [],
        ...(t === 'chip' && !get().annotationTag ? { annotationTag: DEFAULT_TAG } : {}),
      });
      if ((t === 'zone' || t === 'erase') && s.annotationDraft?.kind === 'zone') change();
      else s.requestAnnotationDiscard(change);
    },
    requestAnnotationDiscard: (action) => {
      if (get().annotationDraft) set({ annotationDiscardAction: action });
      else action();
    },
    cancelAnnotationDiscard: () => set({ annotationDiscardAction: null }),
    confirmAnnotationDiscard: () => {
      const action = get().annotationDiscardAction;
      if (!action) return;
      get().discardAnnotationDraft();
      action();
    },
    confirmAnnotationSave: () => {
      const action = get().annotationDiscardAction;
      if (!action) return;
      get().commitAnnotationDraft();
      set({ annotationDiscardAction: null });
      action();
    },
    discardAnnotationDraft: () => {
      const d = data();
      const current = JSON.stringify(d ? kept(d) : kept({ items: [] }));
      const clean = (lane: string[]) => {
        const result: string[] = [];
        let last = current;
        for (const entry of [...lane].reverse()) {
          const notes = JSON.stringify(kept(JSON.parse(entry) as AnnotationSnapshot));
          if (notes !== last) result.unshift(JSON.stringify({ ...JSON.parse(notes), draft: null }));
          last = notes;
        }
        return result;
      };
      set((s) => ({
        annotationDraft: null, annotationDiscardAction: null,
        annotationUndoLane: clean(s.annotationUndoLane),
        annotationRedoLane: clean(s.annotationRedoLane),
        annotationHistoryEpoch: s.annotationHistoryEpoch + 1,
      }));
    },
    toggleAnnotationTool: (t) => get().setAnnotationTool(get().annotationTool === t ? 'none' : t),
    setAnnotationZoneShape: (shape) => set({ annotationZoneShape: shape }),
    setAnnotationColor: (c) => set({ annotationColor: c, ...patchStanding(get(), (n) => ({ ...n, color: c } as MapAnnotation)) }),
    setAnnotationTag: (tag) => set({ annotationTag: tag, ...patchStanding(get(), tagPatch(tag)) }),
    addCustomTag: (text) => {
      const d = data();
      const trimmed = text.trim();
      if (!d || !trimmed) return null;
      const existing = d.customTags?.find((t) => t.text === trimmed);
      if (existing) { get().setAnnotationTag(existing.id); return existing.id; }
      if ((d.customTags?.length ?? 0) >= CUSTOM_TAG_MAX) return null;
      const tag: CustomTag = { id: generateCustomTagId(), text: trimmed };
      const lane = strokeFields(get(), d);
      d.customTags = [...(d.customTags ?? []), tag];
      const s = get();
      set({ ...lane, annotationTag: tag.id, annotationsEpoch: s.annotationsEpoch + 1, ...patchStanding(s, tagPatch(tag.id), true) });
      return tag.id;
    },
    removeCustomTag: (id) => {
      const d = data();
      if (!d?.customTags?.some((t) => t.id === id)) return;
      const gone = new Set<string>([id]);
      const lane = strokeFields(get(), d);
      const next = keepCustomTags(d, (t) => t.id !== id);
      if (next.customTags) d.customTags = next.customTags;
      else delete d.customTags;
      d.items = next.items;
      set((s) => {
        const draft = s.annotationDraft ? withoutTagsOn([s.annotationDraft], gone)[0] ?? null : null;
        const live = new Set(d.items.map((n) => n.id));
        return {
          ...lane,
          annotationsEpoch: s.annotationsEpoch + 1,
          annotationDraft: draft,
          annotationSelection: s.annotationSelection.filter((i) => live.has(i)),
          ...(s.annotationTag === id ? { annotationTag: s.annotationTool === 'chip' ? DEFAULT_TAG : null } : {}),
        };
      });
    },
    setAnnotationSize: (size) => set({
      annotationSize: size,
      ...patchStanding(get(), (n) => (n.kind === 'zone' || (n.kind === 'chip' && size !== 'none') ? { ...n, size } as MapAnnotation : n)),
    }),
    setAnnotationRouteDashed: (d) => set({ annotationRouteDashed: d, ...patchStanding(get(), (n) => (n.kind === 'route' ? { ...n, dashed: d } : n)) }),
    setAnnotationRouteWidth: (width) => set({ annotationRouteWidth: width, ...patchStanding(get(), (n) => (n.kind === 'route' ? { ...n, width } : n)) }),
    setAnnotationDimensions: (visible) => set({ annotationDimensions: visible }),
    setAnnotationSelection: (ids) => set({ annotationSelection: ids }),
    setAnnotationDraft: (a) => set({ annotationDraft: a }),
    commitAnnotationDraft: () => {
      const d = get().annotationDraft;
      if (!d) return false;
      if (isEmptyNote(d)) { get().discardAnnotationDraft(); return false; }
      const notes = data();
      const lane = notes && strokeFields(get(), notes);
      notes?.items.push(d);
      set((s) => ({
        ...lane, annotationDraft: null, annotationSelection: [d.id],
        ...(notes ? { annotationsEpoch: s.annotationsEpoch + 1 } : null),
      }));
      return true;
    },

    beginAnnotationStroke: () => {
      const d = data();
      if (d) set(strokeFields(get(), d));
    },
    applyAnnotationEdit: (fn) => {
      const d = data();
      if (!d) return;
      fn(d);
      bump();
    },
    addAnnotation: (a) => {
      get().beginAnnotationStroke();
      get().applyAnnotationEdit((d) => { d.items.push(a); });
    },
    removeAnnotation: (id) => {
      get().removeAnnotations([id]);
    },
    removeAnnotations: (ids) => {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      get().beginAnnotationStroke();
      get().applyAnnotationEdit((d) => { d.items = d.items.filter((n) => !gone.has(n.id)); });
      set((s) => ({ annotationSelection: s.annotationSelection.filter((i) => !gone.has(i)) }));
    },
    mergeAnnotationZones: (ids) => {
      const d = data();
      const merged = d && mergeZones(d.items, ids);
      if (!merged) return;
      get().beginAnnotationStroke();
      get().applyAnnotationEdit((data2) => { data2.items = merged.items; });
      set({ annotationSelection: [merged.head] });
    },
    setMeasurementPoints: (id, points, beginStroke) => {
      const d = data();
      const note = d?.items.find(n => n.id === id);
      if (!d || d.locked || !d.visible || note?.kind !== 'measure') return false;
      if (!isMeasureSpan(points)) return false;
      if (points.every((p, i) => p.x === note.points[i]!.x && p.y === note.points[i]!.y)) return false;
      if (beginStroke) get().beginAnnotationStroke();
      get().applyAnnotationEdit(d => {
        d.items = d.items.map(n => n.id === id ? { ...note, points } : n);
      });
      return true;
    },
    flipMeasurements: (ids) => {
      const d = data();
      if (!d || d.locked || !d.visible) return;
      const selected = new Set(ids);
      if (!d.items.some(n => n.kind === 'measure' && selected.has(n.id))) return;
      get().beginAnnotationStroke();
      get().applyAnnotationEdit(d => { d.items = flipMeasures(d.items, selected); });
    },
    updateAnnotation: (id, patch) => {
      get().beginAnnotationStroke();
      get().applyAnnotationEdit((d) => {
        const i = d.items.findIndex((n) => n.id === id);
        if (i >= 0) d.items[i] = { ...d.items[i], ...patch } as MapAnnotation;
      });
    },
    setAnnotationsVisible: (v) => {
      const d = data();
      if (!d || d.visible === v) return;
      d.visible = v;
      bump();
    },
    setAnnotationsLocked: (v) => {
      const d = data();
      if (!d || d.locked === v) return;
      d.locked = v;
      bump();
    },
    undoAnnotation: () => travel('undo'),
    redoAnnotation: () => travel('redo'),
  };
};

/** A tag pick's edit (`withTag`). */
function tagPatch(tag: NoteTag | null): (n: MapAnnotation) => MapAnnotation {
  return (n) => withTag(n, tag);
}

/** The lane fields that open a stroke: a snapshot of `d` and the draft before its first mutation. */
function strokeFields(
  s: Pick<AnnotationsSlice, 'annotationUndoLane' | 'annotationRedoLane' | 'annotationDraft'>,
  d: AnnotationsState,
): Pick<AnnotationsSlice, 'annotationUndoLane' | 'annotationRedoLane'> {
  const lane = laneRecord(annotationLane(s), snapshot(d, s.annotationDraft));
  return { annotationUndoLane: [...lane.undo], annotationRedoLane: [] };
}

/** Apply an armed option to what is standing: the draft, and the selection as one lane entry, or
 *  as part of the entry the caller opened (`opened`). The items change in place; the returned
 *  fields are the caller's to publish with its own, and null means nothing standing changes. A
 *  hidden or locked layer keeps its notes; the arming still changes. */
function patchStanding(
  s: AnnotationsSlice & Deps,
  patch: (n: MapAnnotation) => MapAnnotation,
  opened = false,
): Partial<AnnotationsSlice> | null {
  if (!s.gridState) return null;
  const data = annotationsOf(s.gridState);
  if (!data.visible || data.locked) return null;
  const picked = new Set(s.annotationSelection);
  const draft = s.annotationDraft ? patch(s.annotationDraft) : null;
  if (JSON.stringify(draft) === JSON.stringify(s.annotationDraft) && !data.items.some(
    (n) => picked.has(n.id) && JSON.stringify(patch(n)) !== JSON.stringify(n),
  )) return null;
  const lane = opened ? null : strokeFields(s, data);
  data.items = data.items.map((n) => (picked.has(n.id) ? patch(n) : n));
  return { ...lane, annotationDraft: draft, annotationsEpoch: s.annotationsEpoch + 1 };
}

/** The session fields a new or loaded map resets, spread by the engine slice's `initMap`/`loadMap`:
 *  a selection, a draft or an undo lane describes the map being left, never the one arriving. */
export const ANNOTATION_SESSION_RESET = {
  annotationSelection: [] as string[],
  annotationDraft: null,
  annotationDiscardAction: null,
  annotationHistoryEpoch: 0,
  annotationUndoLane: [] as string[],
  annotationRedoLane: [] as string[],
} as const;

interface AnnotationSnapshot {
  items: MapAnnotation[];
  /** Absent in an entry with no custom tags. */
  customTags?: CustomTag[];
  draft: MapAnnotation | null;
}

/** What a lane entry restores besides the draft. */
function kept(d: Pick<AnnotationsState, 'items' | 'customTags'>): Omit<AnnotationSnapshot, 'draft'> {
  return { items: d.items, ...(d.customTags?.length ? { customTags: d.customTags } : {}) };
}

function snapshot(d: Pick<AnnotationsState, 'items' | 'customTags'>, draft: MapAnnotation | null): string {
  return JSON.stringify({ ...kept(d), draft });
}
