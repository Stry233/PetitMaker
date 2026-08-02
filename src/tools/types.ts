import type {
  MacroCoord, MicroCoord, ToolType, TerrainType,
  Command, ValidationError, ValidationResult, GridState,
} from '../core/model/types';
import type { ToolOverlay, ViewProjection } from '../canvas/view-projection';
import type { CursorId } from '../core/runtime/cursor-spec';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';

export interface ToolContext {
  gridState: GridState;
  viewport: ViewProjection;
  overlay: ToolOverlay;
  executeCommand: (cmd: Command) => ValidationResult;
  commitStroke: (strokeStartSize: number, opts?: { reconcile?: boolean }) => ValidationError[];
  validateCommand: (cmd: Command) => ValidationError[];
  /** The pre-command rules themselves, for asking about a HYPOTHETICAL grid rather than the live
   *  one — the auto-trim ghost, which runs the trim pass over a scratch copy before the click.
   *  `validateCommand` is this bound to `gridState`. */
  rules: RuleDispatcher;
  undo: () => void;
  getUndoStackSize: () => number;
  /** Fold history entries [start, top) into one undo step. ATOMIC UNDO: a stroke and its auto-trims
   *  fold into ONE undo entry — auto-trim and a gamma click's raise+trim are not user-visible
   *  operations, so they undo with the block step they belong to. */
  collapseHistory: (start: number) => void;
  /** Undo everything back to a watermark, exactly. For a stroke that has to be all-or-nothing:
   *  `commitStroke`'s auto-revert stops as soon as the state is legal, which can leave a multi-part
   *  stroke half-applied — right for a brush, wrong for one that rewrites a shape. */
  rollbackTo: (watermark: number) => void;
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
  /**
   * A multi-click gesture in progress (the curve's chain of anchors) that has painted nothing yet.
   * Escape abandons it and Delete takes back its last step, so those keys reach the pending gesture
   * before they reach the selection. Both return whether there WAS something pending, which is how
   * the keyboard command knows not to fall through. Tools with no such gesture omit them.
   */
  cancelPending?(ctx: ToolContext): boolean;
  undoPendingStep?(ctx: ToolContext): boolean;
  onPointerDown(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onPointerMove(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onPointerUp(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onActivate(ctx: ToolContext): void;
  onDeactivate(ctx: ToolContext): void;
}
