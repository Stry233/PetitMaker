import type { KernelEvents } from '../../core/commands/events';
import type { ToolType } from './vocabulary';

/** The editor's event bus: the kernel's events and the ones the editor around it raises. */
export type EditorEvents = KernelEvents & {
  /** The tool manager has activated the bar's tool, or a new map's manager is armed
   *  (`editor/session/editor-tools.ts`). Anything that asks a tool a question waits for this, or it may ask the
   *  tool the user has just left. */
  'tool-synced': { tool: ToolType };
  /** Something the pointer preview reads changed where the store does not show it (the region
   *  brush's own state); the pointer machine previews again at the pointer. */
  'pointer-resample': Record<string, never>;
  'catalog-reveal': { catalogId: string };
  /** A planet-session ground stroke reached past the canvas edge, the planet's size limit. */
  'ground-clipped': Record<string, never>;
  /** Fired after the viewport pan/zoom transform is applied, so screen-anchored
   *  React overlays (e.g. selection handles) can reposition. */
  'viewport-changed': { zoom: number };
};
