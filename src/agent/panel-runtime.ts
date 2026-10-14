/*
 * The running harness, for the assistant panel's lazy boundary (`ui/agent/PanelColumn.tsx` and its
 * runner hook): the runner host with its session port and editor wiring, and the panel's session
 * verbs. Everything else the panel reads comes from `panel.ts`.
 */
export { createRunnerHost, type PanelRunner, type RunnerHostInputs } from './exec/runner-host';
export {
  answerStandingGate, clearJobs, exportSessionLog, gateCellCount, jobsByMap, lastOrderText, recallNote,
} from './session/panel-verbs';
