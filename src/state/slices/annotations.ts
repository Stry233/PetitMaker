/** Annotation data and drafts share gesture history, independently of terrain edits. */
import type { StateCreator } from 'zustand';
import {
  ANNOTATION_COLORS, createAnnotationsState,
  type AnnotationsState, type AnnotationTool, type AnnotationZoneShape, type MapAnnotation, type TagId, DEFAULT_TAG,
} from '../../core/model/annotations';
import type { EngineSlice } from './engine';
import type { MacroCoord } from '../../core/model/types';

const LANE_LIMIT = 60;

export interface AnnotationsSlice {
  /** Bumped on every annotation data mutation; the freshness key views subscribe to. */
  annotationsEpoch: number;
  annotationTool: AnnotationTool;
  /** Which figure the zone cells lay (the terrain bar's own vocabulary). A property of the zone
   *  tool rather than an arming, so putting the tool down keeps the figure. */
  annotationZoneShape: AnnotationZoneShape;
  annotationColor: string;
  /** The tag a new zone or chip carries, and the tag a pick applies to the selection. */
  annotationTag: TagId | null;
  /** Caption and chip size. */
  annotationSize: 's' | 'm' | 'l';
  annotationRouteDashed: boolean;
  /** The selected notes' ids, in the order they were picked — a SET, like the map's own object
   *  selection: Ctrl-clicks toggle members, batch verbs (delete, merge) act on the whole. The
   *  FIRST id is the primary: a merge keeps its identity. */
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
  setAnnotationZoneShape: (s: AnnotationZoneShape) => void;
  /** Arm a color; a standing selection takes it too, as one lane entry. */
  setAnnotationColor: (c: string) => void;
  /** Arm a tag; a standing draft or selection takes it too. */
  setAnnotationTag: (tag: TagId | null) => void;
  setAnnotationSize: (s: 's' | 'm' | 'l') => void;
  setAnnotationRouteDashed: (d: boolean) => void;
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
  /** Remove several notes as ONE undo-lane entry. */
  removeAnnotations: (ids: string[]) => void;
  /** Merge the given zones into the FIRST of them: its tag, number, colour and size absorb the
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
    if (!g) return null;
    return (g.annotations ??= createAnnotationsState());
  };
  const bump = () => set((s) => ({ annotationsEpoch: s.annotationsEpoch + 1 }));

  /** Step through annotation history: restore the newest snapshot of `from` and push the standing
   *  notes onto `to`. False when there is nothing to restore. */
  function travel(from: 'annotationUndoLane' | 'annotationRedoLane', to: 'annotationUndoLane' | 'annotationRedoLane'): boolean {
    const d = data();
    const lane = get()[from];
    if (!d || lane.length === 0) return false;
    const restored = JSON.parse(lane[lane.length - 1]!) as AnnotationSnapshot;
    set((s) => ({
      [from]: s[from].slice(0, -1),
      [to]: [...s[to], snapshot(d.items, get().annotationDraft)],
      annotationSelection: [],
      annotationDraft: restored.draft,
      ...(restored.draft ? { annotationTool: restored.draft.kind === 'zone' && s.annotationTool === 'erase' ? 'erase' as const : restored.draft.kind } : {}),
      annotationHistoryEpoch: s.annotationHistoryEpoch + 1,
    }));
    d.items = restored.items;
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
      const current = JSON.stringify(data()?.items ?? []);
      const clean = (lane: string[]) => {
        const result: string[] = [];
        let last = current;
        for (const entry of [...lane].reverse()) {
          const items = JSON.stringify((JSON.parse(entry) as AnnotationSnapshot).items);
          if (items !== last) result.unshift(JSON.stringify({ items: JSON.parse(items), draft: null }));
          last = items;
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
    setAnnotationColor: (c) => {
      set({ annotationColor: c });
      patchStanding(get, set, (n) => ({ ...n, color: c } as MapAnnotation));
    },
    setAnnotationTag: (tag) => {
      set({ annotationTag: tag });
      patchStanding(get, set, (n) => (n.kind === 'zone' ? { ...n, tag } : n.kind === 'chip' && tag ? { ...n, tag } : n));
    },
    setAnnotationSize: (size) => {
      set({ annotationSize: size });
      patchStanding(get, set, (n) => (n.kind === 'zone' || n.kind === 'chip' ? { ...n, size } : n));
    },
    setAnnotationRouteDashed: (d) => {
      set({ annotationRouteDashed: d });
      patchStanding(get, set, (n) => (n.kind === 'route' ? { ...n, dashed: d } : n));
    },
    setAnnotationSelection: (ids) => set({ annotationSelection: ids }),
    setAnnotationDraft: (a) => set({ annotationDraft: a }),
    commitAnnotationDraft: () => {
      const d = get().annotationDraft;
      if (!d) return false;
      const empty = d.kind === 'zone' ? d.cells.length === 0 : d.kind === 'route' ? d.points.length < 2 : false;
      if (empty) { get().discardAnnotationDraft(); return false; }
      get().beginAnnotationStroke();
      set({ annotationDraft: null });
      get().applyAnnotationEdit((data) => { data.items.push(d); });
      set({ annotationSelection: [d.id] });
      return true;
    },

    beginAnnotationStroke: () => {
      const d = data();
      if (!d) return;
      set((s) => ({
        annotationUndoLane: [...s.annotationUndoLane.slice(-(LANE_LIMIT - 1)), snapshot(d.items, get().annotationDraft)],
        annotationRedoLane: [],
      }));
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
      if (!d) return;
      const zones = ids
        .map((id) => d.items.find((n) => n.id === id))
        .filter((n): n is Extract<MapAnnotation, { kind: 'zone' }> => n?.kind === 'zone');
      if (zones.length < 2) return;
      const [head, ...rest] = zones;
      const restIds = new Set(rest.map((z) => z.id));
      get().beginAnnotationStroke();
      get().applyAnnotationEdit((data2) => {
        const seen = new Set(head!.cells.map((c) => `${c.x},${c.y}`));
        const cells = [...head!.cells];
        for (const z of rest) for (const c of z.cells) {
          const k = `${c.x},${c.y}`;
          if (!seen.has(k)) { seen.add(k); cells.push(c); }
        }
        const i = data2.items.findIndex((n) => n.id === head!.id);
        if (i >= 0) data2.items[i] = { ...head!, cells };
        data2.items = data2.items.filter((n) => !restIds.has(n.id));
      });
      set({ annotationSelection: [head!.id] });
    },
    setMeasurementPoints: (id, points, beginStroke) => {
      const d = data();
      const note = d?.items.find(n => n.id === id);
      if (!d || d.locked || !d.visible || note?.kind !== 'measure') return false;
      if (points.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y))) return false;
      if (points[0].x !== points[1].x && points[0].y !== points[1].y) return false;
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
      get().applyAnnotationEdit(d => {
        d.items = d.items.map(n => n.kind === 'measure' && selected.has(n.id) ? { ...n, flipped: !n.flipped } : n);
      });
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
    undoAnnotation: () => travel('annotationUndoLane', 'annotationRedoLane'),
    redoAnnotation: () => travel('annotationRedoLane', 'annotationUndoLane'),
  };
};

/** Apply an armed option to what is standing: the draft in place, and the selection as one lane
 *  entry. A hidden or locked layer keeps its notes; the arming still changes. */
function patchStanding(
  get: () => AnnotationsSlice & Deps,
  set: (partial: Partial<AnnotationsSlice>) => void,
  patch: (n: MapAnnotation) => MapAnnotation,
): void {
  const s = get();
  if (!s.gridState) return;
  const data = s.gridState.annotations ??= createAnnotationsState();
  if (!data.visible || data.locked) return;
  const picked = new Set(s.annotationSelection);
  const draft = s.annotationDraft ? patch(s.annotationDraft) : null;
  if (JSON.stringify(draft) === JSON.stringify(s.annotationDraft) && !data.items.some((n) => picked.has(n.id) && JSON.stringify(patch(n)) !== JSON.stringify(n))) return;
  s.beginAnnotationStroke();
  set({ annotationDraft: draft });
  s.applyAnnotationEdit((d) => { d.items = d.items.map((n) => (picked.has(n.id) ? patch(n) : n)); });
}

/** The session fields a NEW or LOADED map resets, spread by the engine slice's `initMap`/`loadMap`:
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
  draft: MapAnnotation | null;
}

function snapshot(items: MapAnnotation[], draft: MapAnnotation | null): string {
  return JSON.stringify({ items, draft });
}
