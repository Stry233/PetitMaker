/*
 * Where a key acts, and what a contextual key does there. `keyContext` is the one resolution of the
 * context and `appKeyReaches` the one answer to whether an app-wide binding hears a press made in a
 * text field; `CONTEXT_KEYS` gives each context's keys their action and label, read by the toolbar's
 * labels and by the command bodies (`editor/commands/commands.ts`) alike.
 */
import { isTextEntry } from '../../platform/input/text-entry';
import { isAnnotating, isContentMode, type BuildMode } from '../editing/edit-mode';
import type { AnnotationTool, DesignMode, ObjectBrush } from '../editing/vocabulary';
import { blueprintSaving, type BlueprintStep } from '../slices/blueprint';
import type { I18nKey } from '../../i18n/keys';
import type { CommandId } from './registry';

export const TOOLBAR_CONTEXTS = ['terrain', 'region', 'objects', 'notes-zone', 'notes-erase', 'notes-chip', 'notes-route', 'notes-other'] as const;
export type ToolbarContext = typeof TOOLBAR_CONTEXTS[number];

/** Where a contextual key acts: a toolbar's context, or the map, where no build toolbar is up and
 *  the keys keep the terrain toolbar's layout. */
export type KeyContext = ToolbarContext | 'map';

/** A surface standing in the bar's place: Blueprint's save step, its frame step, the region screen
 *  of the generate shelf or the assistant, or the object shelf's brush bar (EDIT-64). */
export type BarFront = 'save' | 'frame' | 'scope' | 'brush';

/** What the bar's front reads of the editor. */
interface BarFrontInputs {
  blueprintStep: BlueprintStep;
  selectingRegion: boolean;
  regionSelectionOwner: string | null;
  editMode: { mode: BuildMode };
  /** The object shelf's brush bar is asked for (EDIT-64). */
  objectBrushBar: boolean;
}

/** Whether the object shelf's brush bar is open, in front or under a region screen; a card armed in it
 *  is part of its state either way. */
export const brushBarOpen = (s: Pick<BarFrontInputs, 'objectBrushBar' | 'editMode'>): boolean =>
  s.objectBrushBar && s.editMode.mode === 'object';

/** Which surface stands in the bar's place, or null where the mode's own bar does: the save step,
 *  then a region being painted (Blueprint's as its frame step), then the open brush bar. The screen
 *  the frame shows, where a key acts and what a back-out ends all read this one answer. */
export function barInFront(s: BarFrontInputs): BarFront | null {
  if (blueprintSaving(s.blueprintStep)) return 'save';
  if (s.selectingRegion) return s.regionSelectionOwner === 'blueprint' ? 'frame' : 'scope';
  return brushBarOpen(s) ? 'brush' : null;
}

/** What the key context reads of the editor. */
export interface KeyContextInputs extends BarFrontInputs {
  annotationTool: AnnotationTool;
}

/** Where a key acts, in precedence order: the region brush, the object brush bar (`barInFront`), the
 *  notes (by their armed tool), a terrain surface's build tools, or the map. */
export function keyContext(s: KeyContextInputs): KeyContext {
  const front = barInFront(s);
  if (front === 'frame' || front === 'scope') return 'region';
  if (front === 'brush') return 'objects';
  if (isAnnotating(s)) {
    const tool = s.annotationTool;
    return tool === 'zone' || tool === 'erase' || tool === 'chip' || tool === 'route' ? `notes-${tool}` : 'notes-other';
  }
  return isContentMode(s.editMode.mode) ? 'terrain' : 'map';
}

/** A key press as `appKeyReaches` reads it. */
interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
  getModifierState(key: string): boolean;
}

/** Whether an app-wide binding (What's this, the interface scale keys) hears `press`: anywhere but a
 *  text field, and in one only a press that types nothing there, an F key or a Ctrl or Cmd chord
 *  (AltGraph, which types, aside), so a binding moved onto a letter never fires while the user types. */
export function appKeyReaches(press: KeyPress): boolean {
  if (!isTextEntry(press.target)) return true;
  return /^F\d+$/.test(press.key) || ((press.ctrlKey || press.metaKey) && !press.getModifierState('AltGraph'));
}

/** The toolbar whose keys a context uses. */
export function toolbarContextOf(s: KeyContextInputs): ToolbarContext {
  const context = keyContext(s);
  return context === 'map' ? 'terrain' : context;
}

/** Whether `context` is one of the notes toolbars. */
export function isNotesContext(context: KeyContext): boolean {
  return context.startsWith('notes-');
}

/** What a contextual key does. */
export type KeyAction =
  /** Toggles a terrain surface's build tool. */
  | { do: 'build-tool'; tool: 'brush' | 'erase' | 'trim' }
  /** Opens the build bar on `mode`, or puts the tool down when that mode is already up. */
  | { do: 'open-build'; mode: DesignMode }
  /** Picks the region brush (with its remembered figure) or the region eraser. */
  | { do: 'region-tool'; tool: 'brush' | 'erase' }
  /** Picks how an armed card places. */
  | { do: 'object-brush'; brush: ObjectBrush }
  /** Toggles a notes tool. */
  | { do: 'note-tool'; tool: Exclude<AnnotationTool, 'none'> }
  | { do: 'smart-build' }
  /** Steps the build brushes' auto edge cut. */
  | { do: 'auto-edge-cut' }
  | { do: 'region-dimensions' }
  /** Steps the armed note's text size. */
  | { do: 'note-size' }
  | { do: 'route-dashes' };

/** A key in a context: what it does there, if anything, and the label it shows when that differs
 *  from the command's own. */
interface ContextKey {
  action?: KeyAction;
  label?: I18nKey;
}

/** The commands whose action and label follow the context. */
const CONTEXTUAL_COMMANDS = ['tool.brush', 'tool.erase', 'tool.trim', 'tool.smart', 'tool.measure', 'tool.option_cycle'] as const satisfies readonly CommandId[];
export type ContextualCommandId = typeof CONTEXTUAL_COMMANDS[number];

const isContextual = (id: string): id is ContextualCommandId => (CONTEXTUAL_COMMANDS as readonly string[]).includes(id);

type ContextKeys = Readonly<Partial<Record<ContextualCommandId, ContextKey>>>;

const NOTE_KEYS: ContextKeys = {
  'tool.brush': { action: { do: 'note-tool', tool: 'zone' } },
  'tool.erase': { action: { do: 'note-tool', tool: 'erase' }, label: 'annot.erase' },
  'tool.trim': { action: { do: 'note-tool', tool: 'chip' }, label: 'annot.chip' },
  'tool.smart': { action: { do: 'note-tool', tool: 'route' }, label: 'annot.route' },
  'tool.measure': { action: { do: 'note-tool', tool: 'measure' } },
};
const NOTE_SIZE: ContextKey = { action: { do: 'note-size' }, label: 'annot.size' };

/** Every context's contextual keys. A key a context leaves out does nothing there. */
export const CONTEXT_KEYS: Readonly<Record<KeyContext, ContextKeys>> = {
  terrain: {
    'tool.brush': { action: { do: 'build-tool', tool: 'brush' } },
    'tool.erase': { action: { do: 'build-tool', tool: 'erase' } },
    'tool.trim': { action: { do: 'build-tool', tool: 'trim' } },
    'tool.smart': { action: { do: 'smart-build' } },
    'tool.option_cycle': { action: { do: 'auto-edge-cut' } },
  },
  map: {
    'tool.brush': { action: { do: 'open-build', mode: 'free' } },
    'tool.erase': { action: { do: 'open-build', mode: 'erase' } },
    'tool.trim': { action: { do: 'open-build', mode: 'trim' } },
    'tool.smart': { action: { do: 'smart-build' } },
  },
  objects: {
    'tool.brush': { action: { do: 'object-brush', brush: 'place' }, label: 'objects.place' },
    'tool.erase': { action: { do: 'object-brush', brush: 'paint' }, label: 'objects.paint' },
  },
  region: {
    'tool.brush': { action: { do: 'region-tool', tool: 'brush' } },
    'tool.erase': { action: { do: 'region-tool', tool: 'erase' } },
    'tool.option_cycle': { action: { do: 'region-dimensions' }, label: 'region.dimensions' },
  },
  'notes-zone': { ...NOTE_KEYS, 'tool.option_cycle': NOTE_SIZE },
  'notes-chip': { ...NOTE_KEYS, 'tool.option_cycle': NOTE_SIZE },
  'notes-route': { ...NOTE_KEYS, 'tool.option_cycle': { action: { do: 'route-dashes' }, label: 'annot.line_style' } },
  'notes-erase': { ...NOTE_KEYS, 'tool.option_cycle': { label: 'annot.size' } },
  'notes-other': { ...NOTE_KEYS, 'tool.option_cycle': { label: 'annot.size' } },
};

/** The keys of `context` whose action is of `kind`, in the toolbar's order, each with its command:
 *  the table read backwards, which a toolbar's pills are drawn from. */
export function contextKeysDoing<D extends KeyAction['do']>(
  context: KeyContext, kind: D,
): { id: ContextualCommandId; action: Extract<KeyAction, { do: D }> }[] {
  return CONTEXTUAL_COMMANDS.flatMap((id) => {
    const action = CONTEXT_KEYS[context][id]?.action;
    return action?.do === kind ? [{ id, action: action as Extract<KeyAction, { do: D }> }] : [];
  });
}

const TERRAIN_TOOLS: readonly CommandId[] = ['tool.brush', 'tool.erase', 'tool.trim', 'tool.smart'];
const NOTE_TOOLS: readonly CommandId[] = [...TERRAIN_TOOLS, 'tool.measure'];
const OPTIONS: readonly CommandId[] = ['tool.shape_cycle', 'tool.option_cycle'];
const COMMANDS: ReadonlySet<string> = new Set([...NOTE_TOOLS, ...OPTIONS]);

/** The brush bar keeps the terrain bar's keys: its two pills on 1 and 2, the shape on the terrain's 5. */
const OBJECT_BINDINGS: ReadonlyMap<string, string> = new Map([['tool.brush', '1'], ['tool.erase', '2'], ['tool.shape_cycle', '5']]);

/** Main pills and intermediate option groups count from 1; the final option group uses Q. */
function makeBindings(context: ToolbarContext): ReadonlyMap<string, string> {
  if (context === 'objects') return OBJECT_BINDINGS;
  const numbered: readonly CommandId[] = context === 'region' ? ['tool.brush', 'tool.erase', 'tool.shape_cycle']
    : context === 'terrain' ? [...TERRAIN_TOOLS, 'tool.shape_cycle']
    : context === 'notes-zone' || context === 'notes-erase' ? [...NOTE_TOOLS, 'tool.shape_cycle'] : NOTE_TOOLS;
  const bindings = new Map(numbered.slice(0, 9).map((id, index) => [id, String(index + 1)]));
  // The eraser's shapes are its only option group, numbered like the brush's; it has no Q group.
  if (context !== 'notes-other' && context !== 'notes-erase') bindings.set('tool.option_cycle', 'q');
  return bindings;
}

const BINDINGS = new Map(TOOLBAR_CONTEXTS.map(context => [context, makeBindings(context)]));

function toolbarBindings(context: ToolbarContext): ReadonlyMap<string, string> {
  return BINDINGS.get(context)!;
}

/** The toolbar whose layout gives a toolbar command its key where no toolbar is named (the keymap
 *  file, the presets, the held-key loop, Help): the one toolbar that binds every toolbar command. */
export const CONTEXT_FREE_TOOLBAR: ToolbarContext = 'notes-zone';

/** A toolbar command's shipped key in `context` (null where that toolbar leaves it out); undefined
 *  for any other command, whose key is its registry row's. */
export function toolbarDefault(context: ToolbarContext, id: string): string | null | undefined {
  return COMMANDS.has(id) ? toolbarBindings(context).get(id) ?? null : undefined;
}

/** The label command `id` shows in `context`, when the context gives it one of its own. */
export function toolbarLabel(context: ToolbarContext, id: string): I18nKey | undefined {
  return isContextual(id) ? CONTEXT_KEYS[context][id]?.label : undefined;
}
