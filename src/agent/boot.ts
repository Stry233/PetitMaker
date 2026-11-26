/*
 * The harness as the frame's first load reads it: the session store the shell and the hosted
 * character watch, the connection store over the credential store and its sealed keys with the
 * readiness reads every surface shares, the model rosters and what each session phase means for the
 * loop. These load with the frame anyway, so this facade adds nothing to the first load. The panel's
 * own reading is `panel.ts`, loaded with its chunk, and its lazy boundary runs the harness through
 * `panel-runtime.ts`.
 */
import { onSessionRestored } from '../editor/session/restore';
import { useAgentConnection } from './connection/store';
import { jobRunningIn, useAgentSession } from './session/store';

export { jobRunningIn, panelView, useAgentSession } from './session/store';
export { PHASE_TRAITS } from './core/view-types';
export {
  connectionGaps, connectionReady, effortKey, isConnected, runnerSettings,
  useAgentConnection, type ArmedConnection,
} from './connection/store';

/** Reads the saved provider, model, supervision and key status, as the page opens. */
export function hydrateAssistantConnection(): Promise<void> {
  return useAgentConnection.getState().hydrate();
}

/** Keeps the assistant's session with the map through a restore: each restore the editor reports
 *  reads the saved session of the map it installed, whoever asked for the restore. Returns the stop. */
export function watchRestoredSession(): () => void {
  return onSessionRestored(() => useAgentSession.getState().hydrate());
}

/** Whether an assistant job is live now. */
export function assistantJobRunning(): boolean {
  return jobRunningIn(useAgentSession.getState());
}
