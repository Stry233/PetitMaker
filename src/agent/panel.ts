/*
 * The harness as the assistant panel reads it: the projection, its labels, the provider metadata and
 * catalog. The runner, the session store and the tool surface are `panel-runtime.ts`, which only the
 * panel's lazy boundary imports, so a card or a Help figure never pulls the running harness in.
 * Turn budgets come from `limits.ts`, not from here.
 */
export type {
  AskRecord, GateVerdict, JobView, OpRow, PanelView, SessionPhase, ThoughtTurn,
} from './core/project-view';
export type { ErrorClass, GateOption, JobOutcome, PlanStage, ToolResultDetail } from './core/types';
export { OVERSIGHTS, type Oversight } from './core/gates';
export type { LiveConnection, RunnerConfig } from './exec/runner';
export type { AgentToolDeps } from './tools/deps';
export { classify, type RawFailure } from './core/errors';
export { toRawFailure } from './providers/http-failure';
export { describeToolArgs } from './tools/describe';
export { buildAdapter, preloadAdapter } from './providers/connect';
export { baseUrlFor, isRegionSplit, PROVIDER_IDS, PROVIDER_META, providerBaseUrls, QUIRKS, type ProviderId, type ProviderRegion } from './providers/defaults';
export { detectProviderFromKey } from './providers/detect';
export {
  checkKey, defaultListModels, fileEndpoint, forgetKeyAndRosters, loadRoster,
  type KeyCheck, type ListModels, type ListModelsRequest,
} from './connection/model-discovery';
export { readKeyShape, type KeyShape } from './connection/key-grammar';
export { createKeyReading, IDLE_MS, type SetupEntry } from './connection/key-reading';
export {
  assistantModels, catalogProvider, catalogVersion, ensureModelCatalog, modelCapabilities, subscribeCatalog, suggestedModels,
} from './providers/model-catalog';
export { thinkingChoiceKey, thinkingChoices } from './providers/reasoning';
export { composerRoute, type ComposerRoute } from './session/composer-routing';
export { displayAgentText, toolVerbKey } from './tools/labels';
export { TOOL_NAMES, isToolName, type ToolName } from './tools/names';
export { PROTOCOL } from './core/protocol';
export { callFootprint, jobFootprint, type CellBox } from './tools/geometry';
export { skillTitleKey } from './skills/titles';
export { proposeSketches, type SketchArt, type SketchDir, type SketchKind, type SketchProposal } from './tools/sketch';
