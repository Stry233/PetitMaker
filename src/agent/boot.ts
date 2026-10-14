/*
 * The harness as the frame's first load reads it: the session store the shell and the hosted
 * character watch, the connection store over the credential store and its sealed keys with the
 * readiness reads every surface shares, and the model rosters. These load with the frame anyway,
 * so this facade adds nothing to the first load. The panel's own reading is `panel.ts`, loaded with
 * its chunk, and its lazy boundary runs the harness through `panel-runtime.ts`.
 */
import { useAgentConnection } from './connection/store';
import { jobRunningIn, useAgentSession } from './session/store';

export { jobRunningIn, panelView, useAgentSession } from './session/store';
export {
  connectionGaps, connectionReady, effortKey, isConnected, providerForSavedKey, providerRegion, runnerSettings,
  setLiveJobStop, useAgentConnection, type AgentConnectionState, type ArmedConnection,
} from './connection/store';
export { forgetRoster, forgetRosters, rememberedRoster, rememberRoster, rosterKey } from './connection/model-roster';

/** Reads the saved provider, model, supervision and key status, as the page opens. */
export function hydrateAssistantConnection(): Promise<void> {
  return useAgentConnection.getState().hydrate();
}

/** Reads the saved assistant session of the map just restored. */
export function hydrateAssistantSession(): void {
  useAgentSession.getState().hydrate();
}

/** Whether an assistant job is live now. */
export function assistantJobRunning(): boolean {
  return jobRunningIn(useAgentSession.getState());
}
