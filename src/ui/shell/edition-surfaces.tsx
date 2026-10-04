import { lazy } from 'react';
import { panelView, useAgentSession } from '../../agent/session/store';
import type { SessionPhase } from '../../agent/core/project-view';
import { isConnected, useAgentPanelSettings } from '../agent/settings';
export { CharacterHost } from '../agent/character/CharacterHost';
export { GenerateShelf } from './bars/GenerateShelf';
export { Windows } from './windows/Windows';
/** Keep the runner and provider SDKs behind the assistant’s first open. */
export const PanelColumn = lazy(() => import('../agent/PanelColumn'));
export function useAssistantConnected(): boolean { return useAgentPanelSettings(isConnected); }
export function clearAssistantSession(): void { useAgentSession.getState().clearSession(); }

/** Phases of an assistant job that still owns the map; a held job resumes onto it. */
const JOB_PHASES: ReadonlySet<SessionPhase> = new Set(['thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing', 'paused']);

/** An assistant job is live. A log restored from storage has no job behind it. */
export function assistantJobRunning(): boolean {
  return jobRunningIn(useAgentSession.getState());
}

/** `assistantJobRunning`, re-read whenever the assistant session changes. */
export function useAssistantJobRunning(): boolean {
  return useAgentSession(jobRunningIn);
}

function jobRunningIn(session: ReturnType<typeof useAgentSession.getState>): boolean {
  return !session.restored && JOB_PHASES.has(panelView(session).phase);
}
