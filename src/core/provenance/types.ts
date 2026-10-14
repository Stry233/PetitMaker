
/** Persisted edit-source identifiers; retain their numeric values. */
export enum ProvSource {
  Human = 0, Procedural = 1, AiWrite = 2, AiAccepted = 3,
  AiAnalysis = 4, AutoRepair = 5, AutoTrim = 6, Imported = 7, Unknown = 8,
}

/** The disclosure labels a whole map can carry — all phrased positively at the copy layer. */
export type DisclosureClass =
  | 'human_created' | 'procedural' | 'contains_ai_assisted' | 'mixed_human_ai'
  | 'ai_used_no_remaining_ai_content' | 'unknown';

export const TaintFlag = {
  CONTAINS_AI: 1, CONTAINS_PROC: 2, HUMAN_AFTER_AI: 4,
  AI_AFTER_HUMAN: 8, UNKNOWN: 16, MODIFIED_BY_AI: 32,
} as const;
export const hasFlag = (bits: number, f: number): boolean => (bits & f) !== 0;
export const setFlag = (bits: number, f: number): number => bits | f;

interface AiMeta { provider?: string; model?: string; toolCallId?: string; userApproved?: boolean }
interface ProceduralMeta { seed: number; algorithm: string; configHash: string }

export interface OperationScope {
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  /** `terrain` is the op's cells and `edgeCutCorners` those of a cosmetic op. `water` and `road` are
   *  reserved: always 0, kept because saved ledgers carry them. */
  counts: { terrain: number; water: number; road: number; edgeCutCorners: number; objAdded: number; objModified: number; objDeleted: number };
  layers: number[]; zones: number[];
  objectIds?: string[];
  coverageCells: number;
}

/** The version a build without an injected stamp reports (unit tests, bare script imports). The app
 *  passes its own version into the tracker; core never reads the build identity itself. */
export const UNSTAMPED_APP_VERSION = '0.0.0';

type OpStatus = 'applied' | 'reverted';
export type ActorType = 'user' | 'system' | 'ai' | 'imported';

export interface ProvenanceOperation {
  /** `parents` is reserved: always empty, kept because saved ledgers carry it. */
  id: string; parents: string[]; timestamp: number;
  appVersion: string; schemaVersion: number;
  source: ProvSource; actor: ActorType; disclosure: DisclosureClass;
  tool?: string; status: OpStatus; derived?: boolean;
  scope: OperationScope;
  ai?: AiMeta; procedural?: ProceduralMeta;
}

/** The three classes of authorship a unit's contribution is split across. */
export type AuthorClass = 'ai' | 'human' | 'procedural';

export interface UnitTaint {
  createdByOp: string; lastModifiedByOp: string;
  origin: ProvSource;
  contribution: Record<AuthorClass, number>;
  flags: number;
}

export interface MapProvenanceSummary {
  containsAi: boolean; containsProcedural: boolean;
  aiEverUsed: boolean; aiUsedNoRemaining: boolean;
  /** The shares of content cells with AI and with procedural contribution, in whole percent. */
  aiTerrainPct: number; aiObjectCount: number; proceduralAreaPct: number;
  humanAfterAi: boolean; aiAfterHuman: boolean;
  exportDisclosure: DisclosureClass;
}

/** `aiAnalysisUsed` and `analysisOnlyCalls` are save fields no editor path sets; saves carry them through. */
export interface SessionFlags {
  aiAnalysisUsed: boolean; aiWritesUsed: boolean;
  aiAcceptedCount: number; proceduralRuns: number; analysisOnlyCalls: number;
  humanAfterAi: boolean; aiAfterHuman: boolean;
}

export interface ProvenanceState {
  ledger: ProvenanceOperation[];
  cellTaint: (UnitTaint | null)[][];   // [y][x], parallel to GridState.cells
  objectTaint: Map<string, UnitTaint>;
  session: SessionFlags;
  summary: MapProvenanceSummary | null; // memoized; null = dirty
}

/** Pushed onto the executor's ambient stack by whoever drives a stroke. */
export interface SourceContext {
  source: ProvSource;
  tool?: string;
  ai?: AiMeta;
  procedural?: ProceduralMeta;
}
