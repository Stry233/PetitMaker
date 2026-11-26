/*
 * The running harness, for the assistant panel's lazy boundary (`ui/agent/PanelColumn.tsx` and its
 * runner hook): the runner host with its session port and editor wiring, the repairs the harness
 * has a part in, and the panel's session verbs. Everything else the panel reads comes from `panel.ts`.
 */
export { createRunnerHost, type PanelRunner } from './exec/runner-host';
export { runRepair } from './exec/panel-repairs';
export {
  answerStandingGate, clearJobs, gateCellCount, jobsByMap, pickGateOption, recallNote, recordsOf, takeBackJob, takeBackTo,
} from './session/panel-verbs';
