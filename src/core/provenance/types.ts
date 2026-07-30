
/** The taxonomy of who/what authored an edit. Order is significant: higher = "more AI" for dominance ties. */
export enum ProvSource {
  Human = 0, Procedural = 1, AiWrite = 2, AiAccepted = 3,
  AiAnalysis = 4, AutoRepair = 5, AutoTrim = 6, Imported = 7, Unknown = 8,
}

/** The disclosure labels a whole map can carry — all phrased positively at the copy layer. */
export type DisclosureClass =
  | 'human_created' | 'procedural' | 'contains_ai_assisted'
  | 'ai_with_human_edits' | 'mixed_human_ai'
  | 'ai_used_no_remaining_ai_content' | 'unknown';

export const TaintFlag = {
  CONTAINS_AI: 1, CONTAINS_PROC: 2, HUMAN_AFTER_AI: 4,
  AI_AFTER_HUMAN: 8, UNKNOWN: 16, MODIFIED_BY_AI: 32,
} as const;
export const hasFlag = (bits: number, f: number): boolean => (bits & f) !== 0;
export const setFlag = (bits: number, f: number): number => bits | f;

export interface AiMeta { provider?: string; model?: string; toolCallId?: string; userApproved?: boolean }
export interface ProceduralMeta { seed: number; algorithm: string; configHash: string }

export interface OperationScope {
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  counts: { terrain: number; water: number; road: number; edgeCutCorners: number; objAdded: number; objModified: number; objDeleted: number };
  layers: number[]; zones: number[];
  objectIds?: string[];
  coverageCells: number;
}

export type OpStatus = 'applied' | 'reverted' | 'partial';
export type ActorType = 'user' | 'system' | 'ai' | 'imported';

export interface ProvenanceOperation {
  id: string; parents: string[]; timestamp: number;
  appVersion: string; schemaVersion: number;
  source: ProvSource; actor: ActorType; disclosure: DisclosureClass;
  tool?: string; strokeId?: string; status: OpStatus; derived?: boolean;
  scope: OperationScope;
  beforeHash?: string; afterHash?: string;
  ai?: AiMeta; procedural?: ProceduralMeta;
  promptHash?: string; inputHash?: string; outputHash?: string;
}

export interface UnitTaint {
  createdByOp: string; lastModifiedByOp: string;
  origin: ProvSource;
  contribution: { ai: number; human: number; procedural: number };
  flags: number;
}

export interface MapProvenanceSummary {
  containsAi: boolean; containsProcedural: boolean;
  aiEverUsed: boolean; aiUsedNoRemaining: boolean;
  aiTerrainPct: number; aiObjectCount: number; aiAreaPct: number; proceduralAreaPct: number;
  counts: { aiWrites: number; aiAccepted: number; proceduralRuns: number; analysisOnlyCalls: number };
  humanAfterAi: boolean; aiAfterHuman: boolean;
  dominant: DisclosureClass; exportDisclosure: DisclosureClass;
}

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
