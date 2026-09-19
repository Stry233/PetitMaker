import type { BuildMode } from '../model/edit-mode';
import type { AnnotationTool } from '../model/annotations';

export const TOOLBAR_CONTEXTS = ['terrain', 'notes-zone', 'notes-chip', 'notes-route', 'notes-other'] as const;
export type ToolbarContext = typeof TOOLBAR_CONTEXTS[number];

const TERRAIN_TOOLS = ['tool.brush', 'tool.eraser', 'tool.edgecut', 'tool.smart'];
const NOTE_TOOLS = [...TERRAIN_TOOLS, 'tool.measure'];
const OPTIONS = ['tool.shape_cycle', 'tool.auto_trim'];
const COMMANDS = new Set([...NOTE_TOOLS, ...OPTIONS]);

export function toolbarContext(mode: BuildMode, tool: AnnotationTool): ToolbarContext {
  if (mode === 'annotate') return tool === 'zone' || tool === 'chip' || tool === 'route' ? `notes-${tool}` : 'notes-other';
  return 'terrain';
}

/** Main pills and intermediate option groups count from 1; the final option group uses Q. */
function makeBindings(context: ToolbarContext): ReadonlyMap<string, string> {
  const numbered = context === 'terrain' ? [...TERRAIN_TOOLS, 'tool.shape_cycle']
    : context === 'notes-zone' ? [...NOTE_TOOLS, 'tool.shape_cycle'] : NOTE_TOOLS;
  const bindings = new Map(numbered.slice(0, 9).map((id, index) => [id, String(index + 1)]));
  if (context !== 'notes-other') bindings.set('tool.auto_trim', 'q');
  return bindings;
}

const BINDINGS = new Map(TOOLBAR_CONTEXTS.map(context => [context, makeBindings(context)]));

export function toolbarBindings(context: ToolbarContext): ReadonlyMap<string, string> {
  return BINDINGS.get(context)!;
}

export function toolbarDefault(context: ToolbarContext, id: string): string | null | undefined {
  return COMMANDS.has(id) ? toolbarBindings(context).get(id) ?? null : undefined;
}

export function toolbarLabel(context: ToolbarContext, id: string): string | undefined {
  if (!context.startsWith('notes-')) return undefined;
  if (id === 'tool.auto_trim') return context === 'notes-route' ? 'annot.line_style' : 'annot.size';
  if (id === 'tool.edgecut') return 'annot.chip';
  if (id === 'tool.smart') return 'annot.route';
  if (id === 'tool.eraser') return 'annot.erase';
  return undefined;
}
