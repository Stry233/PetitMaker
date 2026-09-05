/**
 * What the user is building, and how.
 *
 * The tool layer reads four facts — the active tool, the drawing mode, the content being laid, and
 * the armed catalog item. They are one decision, so they are derived here from the three inputs a
 * shell actually offers: the build mode, the tool, and the shape. A shell that sets the four
 * directly has four chances to make them disagree.
 */
import { ToolType, type DesignMode } from './types';

/** What is being built. `null` is rest: the map takes no marks. `annotate` is the plan-notes
 *  layer: it has no block in the mode row — the layer panel's 标注 row and the export modal's
 *  编辑标注 door arm it — but it IS a build mode, so which bar is up and who owns the pointer
 *  stay one fact. */
export type BuildMode = 'object' | 'road' | 'mountain' | 'water' | 'generate' | 'annotate' | null;

/** How it is being built. `none` means a surface is chosen but no tool is armed on it — a
 *  selection gesture left the brush without leaving the surface, so the next mark on the same
 *  content resumes where it left off. (Named apart from any tool's own button: the shell's tool row is
 *  画笔/清除/修边/形状 with no "hand" tile, so `none` doesn't advertise a button that isn't there.)
 *  `smart` arms a macro on the surface — which one is the `macro` input. */
export type BuildTool = 'brush' | 'erase' | 'trim' | 'shape' | 'none' | 'smart';

/** Which figure the shape tool lays. */
export type BuildShape = 'free' | 'line' | 'curve' | 'rect' | 'circle';

/** The surface a build brush lays. Roads are a tile coating; the other two are terrain. */
export type ContentType = 'mountain' | 'water' | 'tile';

export interface EditModeState {
  toolType: ToolType;
  designMode: DesignMode;
  contentType: ContentType;
  armedItem: string | null;
  armedMacro: string | null;
}

const SHAPE_MODE: Record<BuildShape, DesignMode> = {
  free: 'brush', line: 'line', curve: 'curve', rect: 'rect', circle: 'circle',
};

export const CONTENT: Record<Exclude<BuildMode, null | 'object' | 'generate' | 'annotate'>, ContentType> = {
  mountain: 'mountain', water: 'water', road: 'tile',
};

/** Which surface a tap on this content re-opens: the inverse of `CONTENT`, DERIVED, so a shell that
 *  needs it cannot restate it and drift. A road is a coating, so its content is 'tile' where its
 *  mode is 'road', and that is the whole reason the two tables are not the same. */
export const MODE_FOR_CONTENT = Object.fromEntries(
  Object.entries(CONTENT).map(([mode, content]) => [content, mode]),
) as Record<ContentType, Exclude<BuildMode, null | 'object' | 'generate' | 'annotate'>>;

/**
 * The ONE `DesignMode` → `ToolType` mapping, so a mode's implementing tool has one answer
 * regardless of which caller asks. The five shape modes all map to `TerrainBrush` — `DrawingTool`
 * multiplexes the shape internally, so the relation is intentionally many-to-one.
 */
export const DESIGN_MODE_TOOL: Record<DesignMode, ToolType> = {
  brush: ToolType.TerrainBrush,
  line: ToolType.TerrainBrush,
  curve: ToolType.TerrainBrush,
  rect: ToolType.TerrainBrush,
  circle: ToolType.TerrainBrush,
  'edge-cut': ToolType.EdgeCut,
  eraser: ToolType.Eraser,
  hand: ToolType.Hand,
};

/** Map a UI design mode to the tool that implements it. */
export function designModeToToolType(mode: DesignMode): ToolType {
  return DESIGN_MODE_TOOL[mode];
}

const SHAPE_MODES: ReadonlySet<DesignMode> = new Set(['line', 'curve', 'rect', 'circle']);

/** A design mode's `setEditMode` inputs, for a caller that only has the mode (a tool key, a tool
 *  cell in a bar) — the inverse of `resolveEditMode`'s own tool/shape → mode step below. Omits
 *  `mode` so a caller merges it into whatever content surface is already armed. */
export function designModeToEditInputs(mode: DesignMode): { tool: BuildTool; shape?: BuildShape } {
  if (mode === 'eraser') return { tool: 'erase' };
  if (mode === 'edge-cut') return { tool: 'trim' };
  if (mode === 'hand') return { tool: 'none' };
  if (SHAPE_MODES.has(mode)) return { tool: 'shape', shape: mode as BuildShape };
  return { tool: 'brush' };
}

const REST: EditModeState = {
  toolType: ToolType.Hand, designMode: 'hand', contentType: 'mountain', armedItem: null, armedMacro: null,
};

/** The surfaces that take CONTENT. Written once here — `CONTENT`, the arming union and the bars all
 *  key off the same three, so a fourth surface arrives as one type error instead of four. */
export type ContentMode = Exclude<BuildMode, null | 'object' | 'generate' | 'annotate'>;

/**
 * WHAT A CONTENT SURFACE HAS ARMED. One field, so it holds one thing: a surface cannot be erasing
 * AND laying a circle AND holding a macro, which is what five loose fields let it say.
 *
 * `smart` CARRIES its macro, so a macro-less smart tool — the rest state wearing a tool's name —
 * cannot be written down.
 */
export type ContentArming =
  | { kind: 'brush' }
  | { kind: 'erase' }
  | { kind: 'trim' }
  | { kind: 'shape'; shape: BuildShape }
  | { kind: 'none' }
  | { kind: 'smart'; macro: string };

/**
 * WHAT OBJECT MODE HAS ARMED. The shelf offers three things — an item card, a planting card, the
 * eraser — and they are ONE choice, on one field, so an illegal combination (an eraser answering
 * the map behind an armed card) cannot be represented.
 *
 * There is no `brush`, no `trim` and no figure here: the shelf has no tool row.
 */
export type ObjectArming =
  | { kind: 'item'; itemId: string }
  | { kind: 'macro'; macro: string }
  | { kind: 'erase' }
  | { kind: 'none' };

export type Arming = ContentArming | ObjectArming;

/** A mode and what it has armed, paired so the pair cannot be mismatched. `tool` and `shape` are
 *  DERIVED, exactly as `activeTool`/`designMode` are: written only by `nextEditMode`, never read by
 *  `resolveEditMode`. */
interface Inputs<M extends BuildMode, A extends Arming> {
  mode: M;
  arming: A;
  /** The flat tool the bars still read (`terrain-cells.ts:activeCellId`, `SmartBuild`). */
  readonly tool: BuildTool;
  /** WHICH FIGURE THE SHAPE CELL LAYS, remembered across a put-away: it is a property of the shape
   *  tool, not an arming, so putting the tool down must not forget it. */
  readonly shape: BuildShape;
  /** WHAT THE SHELF LAST HELD, remembered while the user is away on a surface: coming back to 物品
   *  resumes this card, and with it the tab the shelf opens on, so a trip to sculpt does not cost
   *  the ramp that was being placed. A property of the shelf, exactly as `shape` is of the shape
   *  tool. */
  readonly heldObject: ObjectArming;
}

export type EditModeInputs =
  | Inputs<ContentMode, ContentArming>
  | Inputs<'object', ObjectArming>
  // Rest is a PAUSE, not a put-down: the map takes no marks and `resolveEditMode` never reads the
  // arming here, but the surface resumes with what it held when the bar comes back. Annotate rides
  // the same arm: WHICH annotation tool is armed is the annotation slice's own field, the way
  // `eraserShape` is the eraser's, so the mode carries no arming of its own.
  | Inputs<null | 'generate' | 'annotate', Arming>;

/** The flat keys every shell caller passes. ONE adapter (`nextEditMode`) turns them into an
 *  arming. */
export interface EditModePatch {
  mode?: BuildMode;
  tool?: BuildTool;
  shape?: BuildShape;
  itemId?: string | null;
  macro?: string | null;
}

/** The initial inputs: nothing chosen, the brush waiting on whatever surface opens first. */
export const REST_INPUTS: EditModeInputs = {
  mode: null, arming: { kind: 'brush' }, tool: 'brush', shape: 'free', heldObject: { kind: 'none' },
};

export function resolveEditMode(inputs: EditModeInputs): EditModeState {
  // A switch, not an if-chain: `inputs.mode`'s rest arm is the UNION `null | 'generate'`, and only
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
      return { toolType: ToolType.Annotate, designMode: 'hand', contentType: 'mountain', armedItem: null, armedMacro: null };
    case 'object':
      return objectState(inputs.arming);
    default:
      return contentState(CONTENT[inputs.mode], inputs.arming);
  }
}

/** Object mode's four armings, in full. The switch is TOTAL and reads nothing else, so the eraser
 *  cannot arrive here uninvited (only an ask builds `{kind:'erase'}`) and an armed card cannot sit
 *  behind one. */
function objectState(arming: ObjectArming): EditModeState {
  switch (arming.kind) {
    case 'erase':
      return { toolType: designModeToToolType('eraser'), designMode: 'eraser', contentType: 'mountain', armedItem: null, armedMacro: null };
    // A macro armed from the shelf is the shelf's other way of placing: it holds the pointer the
    // way an armed item does, so like the placer it sits outside DESIGN_MODE_TOOL.
    case 'macro':
      return { toolType: ToolType.Macro, designMode: 'hand', contentType: 'mountain', armedItem: null, armedMacro: arming.macro };
    // An armed placer has no DesignMode of its own (the map still reads as 'hand' — there is
    // nothing to draw), so this one case sits outside DESIGN_MODE_TOOL by construction.
    case 'item':
      return { toolType: ToolType.ObjectPlacer, designMode: 'hand', contentType: 'mountain', armedItem: arming.itemId, armedMacro: null };
    // Nothing picked: there is nothing to place, so the map rests rather than arming an empty placer.
    case 'none':
      return REST;
  }
}

/** A content surface's six armings, in full, on the surface's own content type. */
function contentState(contentType: ContentType, arming: ContentArming): EditModeState {
  switch (arming.kind) {
    case 'none':
      return { toolType: designModeToToolType('hand'), designMode: 'hand', contentType, armedItem: null, armedMacro: null };
    case 'erase':
      return { toolType: designModeToToolType('eraser'), designMode: 'eraser', contentType, armedItem: null, armedMacro: null };
    case 'trim':
      return { toolType: designModeToToolType('edge-cut'), designMode: 'edge-cut', contentType, armedItem: null, armedMacro: null };
    case 'smart':
      return { toolType: ToolType.Macro, designMode: 'hand', contentType, armedItem: null, armedMacro: arming.macro };
    // A free brush and a shape are the same tool; DrawingTool multiplexes the figure internally.
    case 'brush':
      return { toolType: designModeToToolType('brush'), designMode: 'brush', contentType, armedItem: null, armedMacro: null };
    case 'shape': {
      const designMode = SHAPE_MODE[arming.shape];
      return { toolType: designModeToToolType(designMode), designMode, contentType, armedItem: null, armedMacro: null };
    }
  }
}

/** The flat `tool` the shell still reads, projected from the arming. Object mode has no tool row,
 *  so a card projects as the brush it stands in for. */
const TOOL_OF: Record<Arming['kind'], BuildTool> = {
  brush: 'brush', erase: 'erase', trim: 'trim', shape: 'shape', none: 'none', smart: 'smart',
  item: 'brush', macro: 'brush',
};

/** A content surface's arming from a tool name and the remembered figure — the shape a bar cell or
 *  a keyboard command asks for. Exported because the bars' own tests build one. */
export function contentArming(tool: BuildTool, shape: BuildShape): ContentArming {
  switch (tool) {
    case 'brush': return { kind: 'brush' };
    case 'erase': return { kind: 'erase' };
    case 'trim':  return { kind: 'trim' };
    case 'none':  return { kind: 'none' };
    case 'shape': return { kind: 'shape', shape };
    // `smart` names a macro it was not given: nothing is armed, which is the rest state.
    case 'smart': return { kind: 'none' };
  }
}

/** What THIS call arms on a content surface, or null when it arms nothing and the surface keeps
 *  what it had. `macro` outranks `tool` because the one caller that sends both sends them agreeing
 *  (`SmartBuild`: `{tool:'smart', macro:id}` to arm, `{tool:'brush', macro:null}` to put down). The
 *  macro-before-tool order relies on that agreement: a patch that disagrees (a non-`'smart'` `tool`
 *  alongside a non-null `macro`) is not sent by any of the 19 real call sites today. */
function contentArmedBy(patch: EditModePatch, shape: BuildShape, held: Arming): ContentArming | null {
  if (patch.macro != null) return { kind: 'smart', macro: patch.macro };
  if (patch.tool !== undefined) {
    // `smart` with no macro of its own re-arms the one already held; a macro-less smart tool is
    // rest, not a tool.
    if (patch.tool === 'smart') return held.kind === 'smart' ? held : { kind: 'none' };
    return contentArming(patch.tool, shape);
  }
  // An explicit null puts down what it NAMES and nothing else: `{macro:null}` while a brush is
  // armed names a macro that isn't there.
  if (patch.macro === null && held.kind === 'smart') return { kind: 'none' };
  // A new figure re-arms the shape tool only if the shape tool is what is holding the pointer.
  if (patch.shape !== undefined && held.kind === 'shape') return { kind: 'shape', shape };
  return null;
}

/** What THIS call arms in object mode, or null when it arms nothing. */
function objectArmedBy(patch: EditModePatch, held: Arming): ObjectArming | null {
  if (patch.itemId != null) return { kind: 'item', itemId: patch.itemId };
  if (patch.macro != null) return { kind: 'macro', macro: patch.macro };
  // THE OBJECT ERASER IS ONLY EVER ASKED FOR, NEVER CARRIED: this branch IS the ask (the keyboard
  // command). Every other tool name means "nothing armed" here — the shelf has no tool row, so
  // `brush`/`trim`/`shape` name cells that do not exist in it.
  if (patch.tool !== undefined) return patch.tool === 'erase' ? { kind: 'erase' } : { kind: 'none' };
  if (patch.itemId === null && held.kind === 'item') return { kind: 'none' };
  if (patch.macro === null && held.kind === 'macro') return { kind: 'none' };
  return null;
}

/** What object mode INHERITS when the call arms nothing of its own: the card the shelf last held.
 *
 *  Returning to the shelf is a return, not a reset: a trip to sculpt a hill comes back to the ramp
 *  that was being placed, not to a fresh hunt through the tabs. What resumes is the shelf's OWN
 *  memory (`heldObject`), never the surface's arming: the eraser is the one tool in both families
 *  (the three terrain bars share its cell), and a surface's eraser carried in would put itself
 *  ahead of the shelf's card, with no bar cell to show it. */
function carriedObject(prev: EditModeInputs): ObjectArming {
  if (prev.mode !== 'object') return prev.heldObject;
  return prev.arming;
}

/** What a content surface INHERITS when the call arms nothing of its own. */
function carriedContent(prev: EditModeInputs, surface: ContentMode): ContentArming {
  if (prev.mode === 'object') {
    // The eraser rides between the two families by design; a CARD names nothing a surface can lay,
    // so leaving the shelf for a surface takes that surface's own brush.
    return prev.arming.kind === 'erase' ? { kind: 'erase' } : { kind: 'brush' };
  }
  const held = prev.arming;
  // A MACRO BELONGS TO THE SURFACE IT WAS ARMED ON: a hill armed on 山体 is not a river feature, so
  // a change of surface puts it down.
  if (held.kind === 'smart') return prev.mode === surface ? held : { kind: 'none' };
  // Only reachable through rest (shelf -> close the bar -> a surface).
  if (held.kind === 'item' || held.kind === 'macro') return { kind: 'brush' };
  return held;
}

/**
 * THE ONE ADAPTER: the shell's flat keys in, the arming union out.
 *
 * WHAT THIS CALL ARMS OUTRANKS WHAT WAS CARRIED, and that holds BY ASSIGNMENT: arming is one field,
 * so no recency conditional (item clears macro, macro clears item, a carried eraser demoted in
 * object mode) is needed to keep five separately-writable fields agreeing.
 *
 * Every caller keeps its call shape (`setEditMode({mode, tool, shape, itemId, macro})`); this is
 * where that shape stops.
 */
export function nextEditMode(prev: EditModeInputs, patch: EditModePatch): EditModeInputs {
  const mode = patch.mode === undefined ? prev.mode : patch.mode;
  const shape = patch.shape ?? prev.shape;

  if (mode === null || mode === 'generate' || mode === 'annotate') {
    const arming = prev.arming;
    return { mode, arming, tool: TOOL_OF[arming.kind], shape, heldObject: heldObjectAfter(prev) };
  }
  if (mode === 'object') {
    const arming = objectArmedBy(patch, prev.arming) ?? carriedObject(prev);
    return { mode, arming, tool: TOOL_OF[arming.kind], shape, heldObject: arming };
  }
  const arming = contentArmedBy(patch, shape, prev.arming) ?? carriedContent(prev, mode);
  return { mode, arming, tool: TOOL_OF[arming.kind], shape, heldObject: heldObjectAfter(prev) };
}

/** The shelf's memory after this call: its own arming while the shelf is open, kept as it was
 *  everywhere else. */
function heldObjectAfter(prev: EditModeInputs): ObjectArming {
  return prev.mode === 'object' ? prev.arming : prev.heldObject;
}
