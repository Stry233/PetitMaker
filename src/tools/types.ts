import type {
  MacroCoord, MicroCoord, ToolType, TerrainType,
  Command, ValidationError, ValidationResult, GridState,
} from '../core/model/types';
import type { ToolOverlay, ViewProjection } from '../canvas/view-projection';
import type { CursorId } from '../core/runtime/cursor-spec';

export interface ToolContext {
  gridState: GridState;
  viewport: ViewProjection;
  overlay: ToolOverlay;
  executeCommand: (cmd: Command) => ValidationResult;
  commitStroke: (strokeStartSize: number, opts?: { reconcile?: boolean }) => ValidationError[];
  validateCommand: (cmd: Command) => ValidationError[];
  undo: () => void;
  getUndoStackSize: () => number;
  /** Fold history entries [start, top) into one undo step. ATOMIC UNDO: a stroke and its auto-trims
   *  fold into ONE undo entry — auto-trim and a gamma click's raise+trim are not user-visible
   *  operations, so they undo with the block step they belong to. */
  collapseHistory: (start: number) => void;
  t: (key: string) => string;
  /** Set the layer-panel highlight while auto-stacking (null → follow the
   *  selected layer). Does NOT change the build floor (ctx.elevation). */
  setDisplayLayer: (layer: number | null) => void;
  /** Trigger a placement "plop" (squash + dust) on a freshly point-placed object
   *  once its sprite exists; no-op for bulk adds. Optional — omitted in headless
   *  tests. */
  plopObject?: (id: string) => void;
  terrainType: TerrainType;
  elevation: number;
  brushSize: number;
}

export interface Tool {
  id: ToolType;
  /** WHICH cursor, not a CSS value: the canvas layer owns the CSS (ui/cursors). */
  cursor: CursorId;
  /**
   * False when acting on this cell would be refused, so the cursor can say so BEFORE the
   * click instead of the error flash saying it after. Optional: a tool that cannot answer
   * cheaply omits it and keeps its plain cursor. Must not mutate state.
   */
  canActAt?(coord: MacroCoord, ctx: ToolContext): boolean;
  onPointerDown(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onPointerMove(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onPointerUp(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onActivate(ctx: ToolContext): void;
  onDeactivate(ctx: ToolContext): void;
}
