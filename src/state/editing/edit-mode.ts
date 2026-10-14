/**
 * What the user is building, and how.
 *
 * The store holds one input, `editMode` (the build mode, what it has armed, the remembered shape);
 * the active tool, the toolbar's tool and figure, the drawing mode, the content being laid, the armed
 * item and macro and the brush size are selectors over it (`activeToolOf`, `buildToolOf`,
 * `buildShapeOf`, `designModeOf`, `contentTypeOf`, `armedItemOf`, `armedMacroOf`, `brushSizeOf`), so
 * they cannot disagree with it or with each other.
 */
import { ToolType, type BuildShape, type DesignMode } from './vocabulary';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../core/game/profile';
import type { GridId } from '../../core/grid/grids';
import { SESSION_BUILD_MODES, type PlanetSession } from '../slices/planet-session';

/** What is being built. `null` is rest: the map takes no marks. `annotate` is the plan-notes
 *  layer: it has no block in the mode row — the layer panel's Notes row and the export modal's
 *  note-editing door arm it — but it is a build mode, so which bar is up and who owns the pointer
 *  stay one fact. */
export type BuildMode = 'object' | 'road' | 'mountain' | 'water' | 'generate' | 'annotate' | null;

/** The mode-row modes `session` offers, ground first; null outside a planet session, where the row
 *  offers every mode. */
export function modesInSession(session: PlanetSession | null): readonly BuildMode[] | null {
  return session ? SESSION_BUILD_MODES : null;
}

/** Whether `mode` can be armed in `session`: rest and the notes layer, which has no block in the mode
 *  row, always can; a mode-row mode when the session offers it. */
export function modeOpenIn(session: PlanetSession | null, mode: BuildMode): boolean {
  const offered = modesInSession(session);
  return !offered || mode === null || mode === 'annotate' || offered.includes(mode);
}

/** The toolbar tool an arming shows. `none` is a surface with no tool armed (a selection gesture
 *  left the brush and kept the surface); the tool row has no tile for it. `smart` is a macro armed on
 *  the surface. */
export type BuildTool = 'brush' | 'erase' | 'trim' | 'shape' | 'none' | 'smart';

export type { BuildShape };
export const BUILD_SHAPES: readonly BuildShape[] = ['free', 'line', 'curve', 'rect', 'circle'];

/** The brush size range, in cells, for terrain and region brushes alike. */
export const BRUSH_SIZE = { min: 1, max: 5 } as const;

/** `size` clamped to the brush size range. */
export function clampBrushSize(size: number): number {
  return Math.max(BRUSH_SIZE.min, Math.min(BRUSH_SIZE.max, size));
}

/** The surfaces that take content, named as their build modes: the surface a build brush lays and the
 *  bar that lays it are one fact. Roads are a tile coating; the other two are terrain. */
export type ContentType = Exclude<BuildMode, null | 'object' | 'generate' | 'annotate'>;

/** The grid each surface lies on: terrain on the terrain grid, a road coating on the placement grid
 *  every catalog item stands on. Its keys are the surfaces. */
export const CONTENT_GRID: Readonly<Record<ContentType, GridId>> = {
  mountain: TERRAIN_GRID, water: TERRAIN_GRID, road: PLACEMENT_GRID,
};

interface EditModeState {
  toolType: ToolType;
  designMode: DesignMode;
  contentType: ContentType;
  armedItem: string | null;
  armedMacro: string | null;
}

/** Whether `mode` is a surface that takes content. */
export function isContentMode(mode: BuildMode): mode is ContentType {
  return mode !== null && Object.prototype.hasOwnProperty.call(CONTENT_GRID, mode);
}

/** The tool each drawing mode arms. The five figures all map to `TerrainBrush`, which draws each. */
const DESIGN_MODE_TOOL: Record<DesignMode, ToolType> = {
  free: ToolType.TerrainBrush,
  line: ToolType.TerrainBrush,
  curve: ToolType.TerrainBrush,
  rect: ToolType.TerrainBrush,
  circle: ToolType.TerrainBrush,
  trim: ToolType.EdgeCut,
  erase: ToolType.Eraser,
  none: ToolType.Hand,
};

/** Whether `mode` is a figure the terrain brush draws. */
export function isDrawingMode(mode: DesignMode): mode is BuildShape {
  return DESIGN_MODE_TOOL[mode] === ToolType.TerrainBrush;
}

/** The content arming that draws `mode`, for a caller that only has the mode (a tool key). */
export function designModeArming(mode: DesignMode): ContentArming {
  if (!isDrawingMode(mode)) return { kind: mode };
  return mode === 'free' ? { kind: 'brush' } : { kind: 'shape', shape: mode };
}

const REST: EditModeState = {
  toolType: ToolType.Hand, designMode: 'none', contentType: 'mountain', armedItem: null, armedMacro: null,
};


/** What a content surface has armed: one field, so it holds one thing. `smart` carries its macro, so
 *  a macro-less smart tool cannot be written down. */
export type ContentArming =
  | { kind: 'brush' }
  | { kind: 'erase' }
  | { kind: 'trim' }
  | { kind: 'shape'; shape: BuildShape }
  | { kind: 'none' }
  | { kind: 'smart'; macro: string };

/** What object mode has armed: an item card, a planting card or the eraser, one at a time. The shelf
 *  has no tool row, so there is no brush, trim or figure here. */
export type ObjectArming =
  | { kind: 'item'; itemId: string }
  | { kind: 'macro'; macro: string }
  | { kind: 'erase' }
  | { kind: 'none' };

export type Arming = ContentArming | ObjectArming;

/** A mode and what it has armed, paired so the pair cannot be mismatched. The toolbar's tool and
 *  figure are selectors over the arming (`buildToolOf`, `buildShapeOf`), never stored. */
interface Inputs<M extends BuildMode, A extends Arming> {
  mode: M;
  arming: A;
  /** The figure the brush cell resumes, remembered across a put-away: it is a property of the shape
   *  tool, not an arming, so putting the tool down must not forget it. `free` while the brush is
   *  armed; read it through `buildShapeOf`. */
  readonly heldShape: BuildShape;
  /** What the shelf last held, remembered while the user is away on a surface: coming back to Objects
   *  resumes this card, and with it the tab the shelf opens on. */
  readonly heldObject: ObjectArming;
}

export type EditModeInputs =
  | Inputs<ContentType, ContentArming>
  | Inputs<'object', ObjectArming>
  // Rest is a pause, not a put-down: the map takes no marks and `resolveEditMode` never reads the
  // arming here, but the surface resumes with what it held when the bar comes back. Annotate rides
  // the same arm: which annotation tool is armed is the annotation slice's own field, the way
  // `eraserShape` is the eraser's, so the mode carries no arming of its own.
  | Inputs<null | 'generate' | 'annotate', Arming>;

/** A change to `editMode`: the mode to open (omitted keeps the current one) and what to arm on it
 *  (omitted carries what that mode held). */
export interface EditModeChange {
  mode?: BuildMode;
  arm?: Arming;
}

/** Brush includes its remembered shape; repeated primary-tool presses return to selection. */
export function toggleBuildTool(current: { tool: BuildTool; shape: BuildShape }, tool: 'brush' | 'erase' | 'trim'): ContentArming {
  const active = tool === 'brush' ? current.tool === 'brush' || current.tool === 'shape' : current.tool === tool;
  if (active) return { kind: 'none' };
  if (tool === 'brush') return current.shape === 'free' ? { kind: 'brush' } : { kind: 'shape', shape: current.shape };
  return { kind: tool };
}

/** The initial inputs: nothing chosen, the brush waiting on whatever surface opens first. */
export const REST_INPUTS: EditModeInputs = {
  mode: null, arming: { kind: 'brush' }, heldShape: 'free', heldObject: { kind: 'none' },
};

function resolveEditMode(inputs: EditModeInputs): EditModeState {
  // A switch, not an if-chain: `inputs.mode`'s rest arm is the union `null | 'generate'`, and only
  // a switch's case-by-case narrowing carries that arm's `inputs.arming` down to the branch below
  // as the right member of the union — an if/else on the same checks leaves it unnarrowed.
  switch (inputs.mode) {
    // Generate paints nothing: its shelf runs an operation, and the map stays in rest so a stray
    // click cannot lay a mark while the user is picking a candidate.
    case null:
    case 'generate':
      return REST;
    // The annotate tool owns the pointer while the plan-notes layer is being edited; the four
    // content facts are inert (nothing here lays terrain or arms an item).
    case 'annotate':
      return { toolType: ToolType.Annotate, designMode: 'none', contentType: 'mountain', armedItem: null, armedMacro: null };
    case 'object':
      return objectState(inputs.arming);
    default:
      return contentState(inputs.mode, inputs.arming);
  }
}

/** Object mode's four armings, in full. The switch is total and reads nothing else, so the eraser
 *  cannot arrive here uninvited (only an ask builds `{kind:'erase'}`) and an armed card cannot sit
 *  behind one. */
function objectState(arming: ObjectArming): EditModeState {
  switch (arming.kind) {
    case 'erase':
      return { toolType: DESIGN_MODE_TOOL.erase, designMode: 'erase', contentType: 'mountain', armedItem: null, armedMacro: null };
    // A macro armed from the shelf is the shelf's other way of placing: it holds the pointer the
    // way an armed item does, so like the placer it sits outside DESIGN_MODE_TOOL.
    case 'macro':
      return { toolType: ToolType.Macro, designMode: 'none', contentType: 'mountain', armedItem: null, armedMacro: arming.macro };
    // An armed placer has no DesignMode of its own (there is nothing to draw), so this one case
    // sits outside DESIGN_MODE_TOOL.
    case 'item':
      return { toolType: ToolType.ObjectPlacer, designMode: 'none', contentType: 'mountain', armedItem: arming.itemId, armedMacro: null };
    // Nothing picked: there is nothing to place, so the map rests rather than arming an empty placer.
    case 'none':
      return REST;
  }
}

/** A content surface's six armings, in full, on the surface's own content type. */
function contentState(contentType: ContentType, arming: ContentArming): EditModeState {
  switch (arming.kind) {
    case 'none':
    case 'erase':
    case 'trim':
      return { toolType: DESIGN_MODE_TOOL[arming.kind], designMode: arming.kind, contentType, armedItem: null, armedMacro: null };
    case 'smart':
      return { toolType: ToolType.Macro, designMode: 'none', contentType, armedItem: null, armedMacro: arming.macro };
    // A free brush and a shape are the same tool, which draws the figure it is given.
    case 'brush':
      return { toolType: DESIGN_MODE_TOOL.free, designMode: 'free', contentType, armedItem: null, armedMacro: null };
    case 'shape':
      return { toolType: DESIGN_MODE_TOOL[arming.shape], designMode: arming.shape, contentType, armedItem: null, armedMacro: null };
  }
}

/** The toolbar tool each arming shows. Object mode has no tool row, so a card projects as the
 *  brush it stands in for. */
const TOOL_OF: Record<Arming['kind'], BuildTool> = {
  brush: 'brush', erase: 'erase', trim: 'trim', shape: 'shape', none: 'none', smart: 'smart',
  item: 'brush', macro: 'brush',
};

/** `arm` as object mode holds it. The shelf has no tool row: a surface's smart tool becomes the
 *  shelf's planting card for the same macro, and a brush, trim or figure arms nothing. */
function asObjectArming(arm: Arming): ObjectArming {
  switch (arm.kind) {
    case 'item': case 'macro': case 'erase': case 'none': return arm;
    case 'smart': return { kind: 'macro', macro: arm.macro };
    case 'brush': case 'trim': case 'shape': return { kind: 'none' };
  }
}

/** `arm` as a content surface holds it, or null when it names nothing a surface lays (an item card),
 *  so the surface keeps what it had. A planting card becomes the surface's smart tool. */
function asContentArming(arm: Arming): ContentArming | null {
  switch (arm.kind) {
    case 'item': return null;
    case 'macro': return { kind: 'smart', macro: arm.macro };
    default: return arm;
  }
}

/** What object mode inherits when the call arms nothing of its own: the card the shelf last held.
 *  What resumes is the shelf's own memory (`heldObject`), never the surface's arming: the eraser is
 *  the one tool in both families, and a surface's eraser carried in would put itself ahead of the
 *  shelf's card, with no bar cell to show it. */
function carriedObject(prev: EditModeInputs): ObjectArming {
  if (prev.mode !== 'object') return prev.heldObject;
  return prev.arming;
}

/** What a content surface inherits when the call arms nothing of its own. */
function carriedContent(prev: EditModeInputs, surface: ContentType): ContentArming {
  if (prev.mode === 'object') {
    // The eraser rides between the two families by design; a card names nothing a surface can lay,
    // so leaving the shelf for a surface takes that surface's own brush.
    return prev.arming.kind === 'erase' ? { kind: 'erase' } : { kind: 'brush' };
  }
  const held = prev.arming;
  // A macro belongs to the surface it was armed on: a hill armed on Mountains is not a river feature, so
  // a change of surface puts it down.
  if (held.kind === 'smart') return prev.mode === surface ? held : { kind: 'none' };
  // Only reachable through rest (shelf -> close the bar -> a surface).
  if (held.kind === 'item' || held.kind === 'macro') return { kind: 'brush' };
  return held;
}

/** `inputs` with the road tools a transparent print lacks (trim and smart build) put down to the brush. */
export function withSurfaceTools(inputs: EditModeInputs, printArmed: boolean): EditModeInputs {
  return inputs.mode === 'road' && printArmed && (inputs.arming.kind === 'trim' || inputs.arming.kind === 'smart')
    ? { ...inputs, arming: { kind: 'brush' }, heldShape: 'free' }
    : inputs;
}

/** The inputs `change` makes of `prev`. What the change arms outranks what the mode carried. */
export function nextEditMode(prev: EditModeInputs, change: EditModeChange): EditModeInputs {
  const mode = change.mode === undefined ? prev.mode : change.mode;
  const { arm } = change;
  const shape = arm?.kind === 'shape' ? arm.shape : arm?.kind === 'brush' ? 'free' : prev.heldShape;

  if (mode === null || mode === 'generate' || mode === 'annotate') {
    return { mode, arming: prev.arming, heldShape: shape, heldObject: heldObjectAfter(prev) };
  }
  if (mode === 'object') {
    const arming = arm ? asObjectArming(arm) : carriedObject(prev);
    return { mode, arming, heldShape: shape, heldObject: arming };
  }
  const arming = (arm && asContentArming(arm)) ?? carriedContent(prev, mode);
  return { mode, arming, heldShape: arming.kind === 'brush' ? 'free' : shape, heldObject: heldObjectAfter(prev) };
}

/** The shelf's memory after this call: its own arming while the shelf is open, kept as it was
 *  everywhere else. */
function heldObjectAfter(prev: EditModeInputs): ObjectArming {
  return prev.mode === 'object' ? prev.arming : prev.heldObject;
}

/** What `editMode` resolves into: the selectors below read one resolution per inputs object. */
const resolved = new WeakMap<EditModeInputs, EditModeState>();

function resolvedOf(s: { editMode: EditModeInputs }): EditModeState {
  let state = resolved.get(s.editMode);
  if (!state) { state = resolveEditMode(s.editMode); resolved.set(s.editMode, state); }
  return state;
}

/** The tools a selection may stand under: the Hand tool, and the placer, since an armed placer
 *  still reaches the selection through the modifier and select-instead-of-place. */
const SELECTION_HOLDERS: ReadonlySet<ToolType> = new Set([ToolType.Hand, ToolType.ObjectPlacer]);
/** The terrain brushes (build brush, eraser, edge cut): the multi-select modifier reaches the
 *  selection path from them, and a selection written while one is up puts it away for the Hand tool. */
const BRUSHES: ReadonlySet<ToolType> = new Set([ToolType.TerrainBrush, ToolType.Eraser, ToolType.EdgeCut]);

/** Whether a selection may stand while `tool` is up. The store's writers keep it so
 *  (`slices/edit.ts:editModeFields`, `slices/engine.ts`). */
export const holdsSelection = (tool: ToolType): boolean => SELECTION_HOLDERS.has(tool);
/** Whether `tool` is a terrain brush. */
export const isBrushTool = (tool: ToolType): boolean => BRUSHES.has(tool);

/** The tool the bar resolves to. */
export const activeToolOf = (s: { editMode: EditModeInputs }): ToolType => resolvedOf(s).toolType;
/** The drawing mode the bar resolves to: a figure, the eraser, the trim, or none. */
export const designModeOf = (s: { editMode: EditModeInputs }): DesignMode => resolvedOf(s).designMode;
/** The surface the build brushes lay; mountain while no surface is armed. */
export const contentTypeOf = (s: { editMode: EditModeInputs }): ContentType => resolvedOf(s).contentType;
/** The armed catalog item, or null with nothing armed. */
export const armedItemOf = (s: { editMode: EditModeInputs }): string | null => resolvedOf(s).armedItem;
/** The armed macro's id, or null. */
export const armedMacroOf = (s: { editMode: EditModeInputs }): string | null => resolvedOf(s).armedMacro;

/** The tool the toolbar shows selected, read off the arming. */
export const buildToolOf = (s: { editMode: EditModeInputs }): BuildTool => TOOL_OF[s.editMode.arming.kind];

/** The figure the brush cell draws or resumes: the armed one while the brush or shape tool holds the
 *  pointer, the remembered one otherwise. */
export function buildShapeOf(s: { editMode: EditModeInputs }): BuildShape {
  const { arming, heldShape } = s.editMode;
  return arming.kind === 'shape' ? arming.shape : arming.kind === 'brush' ? 'free' : heldShape;
}

/** The brush size the armed tool draws at: the eraser keeps its own, every other tool shares one. */
export function brushSizeOf(s: { editMode: EditModeInputs; drawingBrushSize: number; eraserBrushSize: number }): number {
  return buildToolOf(s) === 'erase' ? s.eraserBrushSize : s.drawingBrushSize;
}
