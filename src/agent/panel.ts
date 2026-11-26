/*
 * The harness as the assistant panel reads it: the projection, its labels, the provider metadata and
 * catalog. The runner, the session store and the tool surface are `panel-runtime.ts`, which only the
 * panel's lazy boundary imports, so a card or a Help figure never pulls the running harness in.
 * Turn budgets come from `limits.ts`, not from here.
 */
export type {
  AskRecord, GateVerdict, JobView, OpRow, PanelView, SessionPhase, ThoughtTurn,
} from './core/project-view';
export type { PhaseTraits } from './core/view-types';
export type { ErrorClass, GateOption, JobOutcome, PlanStage, ToolResultDetail } from './core/types';
export { OVERSIGHTS, type Oversight } from './core/gates';
export type { LiveConnection } from './exec/runner';
export {
  firstRepair, incidentNotice, noticeOffer, REPAIR_POLICY, repairPolicy, standingActions, troubleStanding,
  type NoticeClass, type RepairAct, type RepairPolicy, type TroubleClass, type TroubleStanding,
} from './core/repair-policy';
export { describeToolArgs } from './tools/describe';
export { isRegionSplit, PROVIDER_IDS, PROVIDER_META, providerBaseUrls, QUIRKS, type ProviderId } from './providers/defaults';
export { defaultListModels, forgetKeyAndRosters, type ListModels } from './connection/model-discovery';
export { createEndpointReading } from './connection/endpoint-reading';
export { type KeyShape } from './connection/key-grammar';
export { createKeyReading, type SetupEntry, type SetupRepair } from './connection/key-reading';
export { signIn } from './connection/sign-in-round';
export { PROVIDER_SIGN_INS } from './providers/sign-in';
export { catalogVersion, modelCapabilities, subscribeCatalog } from './providers/model-catalog';
export { thinkingChoiceKey, thinkingChoices } from './providers/reasoning';
export { composerRoute, type ComposerRoute } from './session/composer-routing';
export { displayAgentText, toolVerbKey } from './tools/labels';
export { TOOL_NAMES, isToolName, type ToolName } from './tools/names';
export { PROTOCOL } from './core/protocol';
export { callFootprint, jobFootprint, type CellBox } from './tools/geometry';
export {
  buildHistory, editCount, isAnswerJob, jobStanding, jobTotals, keyGone, readCount, rewindBlock, rolledBackSeqs, stageTotals,
  takeBackStanding, type JobStanding, type KeyRefusal, type RollbackCost, type TakeBackFacts, type TakeBackStanding, type TerminalShape,
} from './core/job-readings';
export {
  initialZone, reduceZone, repairSteps, sameFacts, sendZoneEvent, type PanelZone, type RepairStep, type ZoneEvent, type ZoneFacts,
} from './connection/panel-zone';
export { skillTitleKey } from './skills/titles';
export { proposeSketches, type SketchArt, type SketchDir, type SketchKind, type SketchProposal } from './tools/sketch';
