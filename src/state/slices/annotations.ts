/**
 * The plan-notes annotation layer's SESSION state and its editing verbs.
 *
 * The annotation DATA lives on `GridState.annotations` — it is map content and rides the save
 * file — so this slice holds what a session brings to it: the armed annotation tool and its
 * options, the selection, the name editor, the in-progress draft, and the layer's own undo/redo
 * lanes. Every data mutation goes through the verbs here, which bump `annotationsEpoch` so
 * subscribed views redraw over the in-place-mutated grid (the same move `objectsVersion` makes
 * for the object index).
 *
 * The lanes are the annotation layer's OWN history, apart from the map's: planning ink and map
 * edits interleave freely, and one shared stack would hand "undo my label" a mountain to take
 * back. A lane entry is the items array whole — a planning layer holds tens of notes, so a
 * snapshot costs less than the bookkeeping a delta would need.
 */
import type { StateCreator } from 'zustand';
import {
  ANNOTATION_COLORS, createAnnotationsState,
  type AnnotationsState, type AnnotationTool, type AnnotationZoneShape, type MapAnnotation,
} from '../../core/model/annotations';
import type { EngineSlice } from './engine';

const LANE_LIMIT = 60;

export interface AnnotationsSlice {
  /** Bumped on every annotation data mutation; the freshness key views subscribe to. */
  annotationsEpoch: number;
  annotationTool: AnnotationTool;
  /** Which figure the zone cells lay (the terrain bar's own vocabulary). A property of the zone
   *  tool rather than an arming, so putting the tool down keeps the figure. */
  annotationZoneShape: AnnotationZoneShape;
  annotationColor: string;
  annotationTextStyle: 'label' | 'chip';
  annotationTextSize: 's' | 'm' | 'l';
  annotationRouteDashed: boolean;
  /** The selected notes' ids, in the order they were picked — a SET, like the map's own object
   *  selection: Ctrl-clicks toggle members, batch verbs (delete, merge) act on the whole. The
   *  FIRST id is the primary: a merge keeps its identity. */
  annotationSelection: string[];
  /** The note whose name editor is open (a zone's name, a text note's words). */
  annotationNaming: string | null;
  /** The note being drawn RIGHT NOW — a zone mid-paint, a route mid-waypoints. Both views draw it
   *  like a committed note; it joins `items` (and the undo lane) only when the gesture commits. */
  annotationDraft: MapAnnotation | null;
  annotationUndoLane: string[];
  annotationRedoLane: string[];
  setAnnotationTool: (t: AnnotationTool) => void;
  setAnnotationZoneShape: (s: AnnotationZoneShape) => void;
  setAnnotationColor: (c: string) => void;
  setAnnotationTextStyle: (s: 'label' | 'chip') => void;
  setAnnotationTextSize: (s: 's' | 'm' | 'l') => void;
  setAnnotationRouteDashed: (d: boolean) => void;
  setAnnotationSelection: (ids: string[]) => void;
  setAnnotationNaming: (id: string | null) => void;
  setAnnotationDraft: (a: MapAnnotation | null) => void;
  /** Push the CURRENT items onto the undo lane (and clear redo) — the one entry a whole gesture
   *  makes, however many `applyAnnotationEdit` calls the gesture then applies. */
  beginAnnotationStroke: () => void;
  /** Mutate the data in place and bump the epoch. No lane entry of its own: a caller that wants
   *  one opens the stroke first. */
  applyAnnotationEdit: (fn: (data: AnnotationsState) => void) => void;
  addAnnotation: (a: MapAnnotation) => void;
  removeAnnotation: (id: string) => void;
  /** Remove several notes as ONE undo-lane entry. */
  removeAnnotations: (ids: string[]) => void;
  /** Merge the given zones into the FIRST of them: its name, number, colour and size absorb the
   *  others' cells (deduplicated), and the absorbed zones go — one lane entry. Ids that are not
   *  zones are ignored; under two zones, nothing happens. */
  mergeAnnotationZones: (ids: string[]) => void;
  updateAnnotation: (id: string, patch: Partial<MapAnnotation>) => void;
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

  return {
    annotationsEpoch: 0,
    annotationTool: 'zone',
    annotationZoneShape: 'free',
    annotationColor: ANNOTATION_COLORS[0]!,
    annotationTextStyle: 'label',
    annotationTextSize: 'm',
    annotationRouteDashed: true,
    annotationSelection: [],
    annotationNaming: null,
    annotationDraft: null,
    annotationUndoLane: [],
    annotationRedoLane: [],
    setAnnotationTool: (t) => set({ annotationTool: t, annotationSelection: [], annotationNaming: null, annotationDraft: null }),
    setAnnotationZoneShape: (shape) => set({ annotationZoneShape: shape, annotationDraft: null }),
    setAnnotationColor: (c) => set({ annotationColor: c }),
    setAnnotationTextStyle: (s) => set({ annotationTextStyle: s }),
    setAnnotationTextSize: (s) => set({ annotationTextSize: s }),
    setAnnotationRouteDashed: (d) => set({ annotationRouteDashed: d }),
    setAnnotationSelection: (ids) => set({ annotationSelection: ids }),
    setAnnotationNaming: (id) => set({ annotationNaming: id }),
    setAnnotationDraft: (a) => set({ annotationDraft: a }),

    beginAnnotationStroke: () => {
      const d = data();
      if (!d) return;
      set((s) => ({
        annotationUndoLane: [...s.annotationUndoLane.slice(-(LANE_LIMIT - 1)), JSON.stringify(d.items)],
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
      set((s) => ({
        annotationSelection: s.annotationSelection.filter((i) => !gone.has(i)),
        annotationNaming: s.annotationNaming && gone.has(s.annotationNaming) ? null : s.annotationNaming,
      }));
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
      set({ annotationSelection: [head!.id], annotationNaming: null });
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
    undoAnnotation: () => {
      const d = data();
      const lane = get().annotationUndoLane;
      if (!d || lane.length === 0) return false;
      const snapshot = lane[lane.length - 1]!;
      set((s) => ({
        annotationUndoLane: s.annotationUndoLane.slice(0, -1),
        annotationRedoLane: [...s.annotationRedoLane, JSON.stringify(d.items)],
        annotationSelection: [],
        annotationNaming: null,
      }));
      d.items = JSON.parse(snapshot) as MapAnnotation[];
      bump();
      return true;
    },
    redoAnnotation: () => {
      const d = data();
      const lane = get().annotationRedoLane;
      if (!d || lane.length === 0) return false;
      const snapshot = lane[lane.length - 1]!;
      set((s) => ({
        annotationRedoLane: s.annotationRedoLane.slice(0, -1),
        annotationUndoLane: [...s.annotationUndoLane, JSON.stringify(d.items)],
        annotationSelection: [],
        annotationNaming: null,
      }));
      d.items = JSON.parse(snapshot) as MapAnnotation[];
      bump();
      return true;
    },
  };
};

/** The session fields a NEW or LOADED map resets, spread by the engine slice's `initMap`/`loadMap`:
 *  a selection, a draft or an undo lane describes the map being left, never the one arriving. */
export const ANNOTATION_SESSION_RESET = {
  annotationSelection: [] as string[],
  annotationNaming: null,
  annotationDraft: null,
  annotationUndoLane: [] as string[],
  annotationRedoLane: [] as string[],
} as const;
