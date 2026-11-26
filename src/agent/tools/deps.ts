/** What every tool handler receives: the map, its executor and the seams the host wires. */
import type { GridState, MacroCoord } from '../../core/model/types';
import type { CustomTag, MapAnnotation } from '../../core/model/annotations';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { CellSet } from '../../core/grid/grids';
import type { CommandInfo, CommandOutcome } from '../../editor/commands/run';

/** The user's single-block selection (mirrors state/store BlockRef). The editor's selection is a
 *  set; this surface has no vocabulary for a group, so a plural selection arrives here as null. */
type SelectedBlock = { kind: 'object'; id: string } | { kind: 'terrain'; x: number; y: number } | null;

/** What a map picture includes beyond the map: `notes` draws the planning annotations over it. */
export interface SnapshotOptions { notes?: boolean }

export interface AgentToolDeps {
  getState(): GridState;
  /** Resolves catalog names for human-facing approval summaries. */
  catalogName?(id: string): string | undefined;
  /** The interface language as a locale id: preset annotation tags are lettered in it. */
  interfaceLanguage?(): string;
  getExecutor(): CommandExecutor;
  /** Applies one reversible edit to the finished notes and custom tags of the job’s captured map. */
  editAnnotations?(edit: (notes: { items: MapAnnotation[]; customTags: CustomTag[] }) => { items: MapAnnotation[]; customTags: CustomTag[] }): boolean;
  getRegion(): MacroCoord[];
  /** The clicked/selected block on canvas, if any. */
  getSelectedBlock?(): SelectedBlock;
  /** Undo-stack size recorded when the running job's first write committed. `undo` stops there, so
   *  the assistant cannot reverse edits the user made before the job started. Absent means 0. */
  undoFloor?(): number;
  /** Visual acknowledgment hook — flashes the edited cells on the canvas, each set on the grid the
   *  tool names (wired to the renderer's commit flash; absent in headless tests). */
  onFlash?(sets: readonly CellSet[]): void;
  /** Calls `listener` once the live map is no longer the one this job edits (another map opened, a
   *  planet session, a restore); returns the unsubscribe. The runner aborts the job on it. */
  onMapLeft?(listener: () => void): () => void;
  /** Rendered-map snapshotter; wire only when the active model supports vision
   *  (supportsVision) — absence makes view_map degrade to the token grid. */
  snapshot?(opts?: SnapshotOptions): Promise<string | null>;
  /** Rendered crop of one rect (absolute map coordinates, corners inclusive); wire only on a
   *  vision seat whose renderer can crop — absence makes a region'd view_map degrade to the
   *  token grid, whether or not the full-map snapshotter is wired. */
  snapshotRegion?(rect: { x1: number; y1: number; x2: number; y2: number }, opts?: SnapshotOptions): Promise<string | null>;
  /** The level picture of a rectangle of terrain cells, the whole map without one
   *  (`exec/snapshot.ts:takeGroundSnapshot`); wired only where `snapshot` is, so a seat that reads no
   *  pictures draws and encodes none. */
  snapshotGround?(rect?: { x1: number; y1: number; x2: number; y2: number }): Promise<{ url: string; origin: { x: number; y: number }; scale: number }>;
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
  /** The editor's commands with their present values; the app-action tools offer a job those their
   *  policy allows. Browser-only; absent in headless runs, where the tools report so. */
  listAppActions?(): CommandInfo[];
  /** Runs one command by id; an unknown id, a bad argument or a refusal answers with its reason. */
  runAppAction?(id: string, args: Record<string, unknown>): Promise<CommandOutcome>;
}
