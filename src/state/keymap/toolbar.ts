/*
 * Where a contextual key acts, and what it does there. `keyContext` is the one resolution of the
 * context; `CONTEXT_KEYS` gives each context's keys their action and label, read by the toolbar's
 * labels and by the command bodies (`editor/commands/commands.ts`) alike.
 */
import { isAnnotating, isContentMode, type BuildMode } from '../editing/edit-mode';
import type { AnnotationTool, DesignMode } from '../editing/vocabulary';
import type { I18nKey } from '../../i18n/keys';
import type { CommandId } from './registry';

export const TOOLBAR_CONTEXTS = ['terrain', 'region', 'notes-zone', 'notes-erase', 'notes-chip', 'notes-route', 'notes-other'] as const;
export type ToolbarContext = typeof TOOLBAR_CONTEXTS[number];

/** Where a contextual key acts: a toolbar's context, or the map, where no build toolbar is up and
 *  the keys keep the terrain toolbar's layout. */
export type KeyContext = ToolbarContext | 'map';

/** What the key context reads of the editor. */
export interface KeyContextInputs {
  selectingRegion: boolean;
  editMode: { mode: BuildMode };
  annotationTool: AnnotationTool;
}

/** Where a key acts, in precedence order: the region brush, the notes (by their armed tool), a
 *  terrain surface's build tools, or the map. */
export function keyContext(s: KeyContextInputs): KeyContext {
  if (s.selectingRegion) return 'region';
  if (isAnnotating(s)) {
    const tool = s.annotationTool;
    return tool === 'zone' || tool === 'erase' || tool === 'chip' || tool === 'route' ? `notes-${tool}` : 'notes-other';
  }
  return isContentMode(s.editMode.mode) ? 'terrain' : 'map';
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
export interface ContextKey {
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

const TERRAIN_TOOLS: readonly CommandId[] = ['tool.brush', 'tool.erase', 'tool.trim', 'tool.smart'];
const NOTE_TOOLS: readonly CommandId[] = [...TERRAIN_TOOLS, 'tool.measure'];
const OPTIONS: readonly CommandId[] = ['tool.shape_cycle', 'tool.option_cycle'];
const COMMANDS: ReadonlySet<string> = new Set([...NOTE_TOOLS, ...OPTIONS]);

/** Main pills and intermediate option groups count from 1; the final option group uses Q. */
function makeBindings(context: ToolbarContext): ReadonlyMap<string, string> {
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
