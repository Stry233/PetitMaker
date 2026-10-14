/*
 * What the editor has armed, as the tools read it: one snapshot derived from the store per state.
 *
 * A tool answers the pointer from what it is handed. Reaching past this into the store would make
 * every field a hidden argument: invisible in the signature, unmockable without seeding a global,
 * and free to differ between the probe that draws the cursor and the click that acts. Derived, never
 * copied onto a tool, so a tool manager built for a map that arrives mid-session reads the bar the
 * shell already shows.
 */
import type { BuildShape, ToolType } from './vocabulary';
import {
  activeToolOf, armedItemOf, armedMacroOf, brushSizeOf, contentTypeOf, designModeOf, isDrawingMode,
  type ContentType,
} from './edit-mode';
import type { EditorStore } from '../store';

/** Store fields a tool reads under their own names. */
const STORE_FIELDS = [
  'layerPinned', 'layerVisibility', 'autoEdgeCut', 'eraserShape',
  'tileMaterial', 'tileMaterialPicked', 'placementRotation', 'armingEpoch', 'region',
  'planetMaterial', 'annotationTool', 'annotationZoneShape', 'annotationColor', 'annotationTag',
  'annotationSize', 'annotationRouteDashed', 'annotationRouteWidth',
] as const satisfies readonly (keyof EditorStore)[];

/** The plan notes' document state the annotate tool reads beside the arming: what is selected, the
 *  draft in progress, the epoch of the notes' undo lanes, and whether a discard awaits an answer. */
export interface NoteDocument {
  readonly selection: EditorStore['annotationSelection'];
  readonly draft: EditorStore['annotationDraft'];
  readonly historyEpoch: number;
  readonly discardPending: boolean;
}

export interface ToolArming extends Readonly<Pick<EditorStore, typeof STORE_FIELDS[number]>> {
  /** The tool the bar resolves to (`activeToolOf`). */
  readonly tool: ToolType;
  /** The figure the terrain brush draws; `free` while another tool is up. */
  readonly shape: BuildShape;
  /** The surface the build brushes lay (`contentTypeOf`). */
  readonly contentType: ContentType;
  /** The size the armed tool draws at (`brushSizeOf`). */
  readonly brushSize: number;
  /** The armed macro's id (`armedMacroOf`), or null. */
  readonly armedMacro: string | null;
  /** The build floor the layer panel selects (`activeLayer`). */
  readonly floor: number;
  /** The armed catalog item (`armedItemOf`), or null with nothing armed. */
  readonly armedItem: string | null;
  /** The planet session unlocks layer 0: sea and bare ground become paintable levels. */
  readonly groundEditable: boolean;
  /** Document state, not what the bar arms; snapshotted with the arming so a call reads one moment. */
  readonly notes: NoteDocument;
}

const memo = new WeakMap<EditorStore, ToolArming>();

/** The arming `s` holds. The store replaces its state object on every change, so one snapshot per
 *  state object serves every reader of that state. */
export function armingOf(s: EditorStore): ToolArming {
  let arming = memo.get(s);
  if (!arming) {
    const passed = Object.fromEntries(STORE_FIELDS.map((key) => [key, s[key]])) as Pick<EditorStore, typeof STORE_FIELDS[number]>;
    const design = designModeOf(s);
    arming = {
      ...passed,
      tool: activeToolOf(s),
      shape: isDrawingMode(design) ? design : 'free',
      contentType: contentTypeOf(s),
      brushSize: brushSizeOf(s),
      armedMacro: armedMacroOf(s),
      floor: s.activeLayer,
      armedItem: armedItemOf(s),
      groundEditable: s.planetSession !== null,
      notes: {
        selection: s.annotationSelection,
        draft: s.annotationDraft,
        historyEpoch: s.annotationHistoryEpoch,
        discardPending: s.annotationDiscardAction !== null,
      },
    };
    memo.set(s, arming);
  }
  return arming;
}

/** Whether two armings answer alike: every field the same by identity. A tool's answers (its
 *  cursor, `canActAt`, its ghost) read the store only through the arming, so this is the one test
 *  of whether a store change can change them. */
export function sameArming(a: ToolArming, b: ToolArming): boolean {
  if (a === b) return true;
  const x = armingInputs(a), y = armingInputs(b);
  return x.length === y.length && x.every((value, i) => value === y[i]);
}

/** Every value an arming holds, the notes' fields spread in, for a caller comparing by identity. */
export function armingInputs({ notes, ...bar }: ToolArming): unknown[] {
  return [...Object.values(bar), ...Object.values(notes)];
}
