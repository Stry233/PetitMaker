/** What every tool handler receives: the map, its executor and the seams the host wires. */
import type { GridState, MacroCoord } from '../../core/model/types';
import type { MapAnnotation } from '../../core/model/annotations';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { CellSet } from '../../core/grid/grids';

/** The user's single-block selection (mirrors state/store BlockRef). The editor's selection is a
 *  set; this surface has no vocabulary for a group, so a plural selection arrives here as null. */
type SelectedBlock = { kind: 'object'; id: string } | { kind: 'terrain'; x: number; y: number } | null;

export interface AgentToolDeps {
  getState(): GridState;
  /** Resolves catalog names for human-facing approval summaries. */
  catalogName?(id: string): string | undefined;
  getExecutor(): CommandExecutor;
  /** Applies one reversible edit to finished notes on the job’s captured map. */
  editAnnotations?(edit: (items: MapAnnotation[]) => MapAnnotation[]): boolean;
  getRegion(): MacroCoord[];
  /** The clicked/selected block on canvas, if any. */
  getSelectedBlock?(): SelectedBlock;
  /** Undo-stack size recorded when the running job's first write committed. `undo` stops there, so
   *  the assistant cannot reverse edits the user made before the job started. Absent means 0. */
  undoFloor?(): number;
  /** Visual acknowledgment hook — flashes the edited cells on the canvas, each set on the grid the
   *  tool names (wired to the renderer's commit flash; absent in headless tests). */
  onFlash?(sets: readonly CellSet[]): void;
  /** Rendered-map snapshotter; wire only when the active model supports vision
   *  (supportsVision) — absence makes view_map degrade to the token grid. */
  snapshot?(): Promise<string | null>;
  /** Rendered crop of one rect (absolute map coordinates, corners inclusive); wire only on a
   *  vision seat whose renderer can crop — absence makes a region'd view_map degrade to the
   *  token grid, whether or not the full-map snapshotter is wired. */
  snapshotRegion?(rect: { x1: number; y1: number; x2: number; y2: number }): Promise<string | null>;
  /**
   * AI provenance descriptor (provider/model + per-edit approval). Absent in headless tests
   * defaults to AI-write with no provider details.
   *
   * `toolCallId` is the call the stroke belongs to, handed in by `executeToolCall` — the stroke
   * runner is given `deps` and never the call, and the export disclosure has to name which call a
   * human approved (`AiAccepted`) as against one that ran under a standing allow-always.
   */
  getProvenanceSource?(toolCallId?: string): {
    provider?: string; model?: string; toolCallId?: string; userApproved?: boolean;
  };
  /** Non-map UI action: open the share-image or JSON export flow for the user
   *  to complete (a file download is outward-facing, so the human confirms it).
   *  Browser-only; absent in headless/tests, where the tool reports so. */
  requestExport?(kind: 'image' | 'json'): void;
}
