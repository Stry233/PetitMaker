import { lazy } from 'react';
import { memoLoad } from '../../platform/async/memo-load';
import { isConnected, jobRunningIn, useAgentConnection, useAgentSession } from '../../agent/boot';
import { DREAM_THUMBS } from '../agent/desk/dream-thumbs';
export { CharacterHost } from '../agent/character/CharacterHost';
export { GenerateShelf } from './bars/generate/GenerateShelf';
export { Windows } from './windows/Windows';
/** The runner and provider SDKs stay behind this chunk; the warm schedule and the panel share its loader. */
export const loadPanelColumn = memoLoad(() => import('../agent/PanelColumn'));
export const PanelColumn = lazy(loadPanelColumn);
/** The illustration window, opened from Export. */
export const loadStylizeWindow = memoLoad(() => import('../chrome/modals/export/stylize/StylizeWindow'));
/** The edition's own first-use files for the warm schedule: the assistant's sample-order captures. */
export const EDITION_WARM_FILES: readonly string[] = Object.values(DREAM_THUMBS);
export function useAssistantConnected(): boolean { return useAgentConnection(isConnected); }
export function clearAssistantSession(): void { useAgentSession.getState().clearSession(); }

export { assistantJobRunning } from '../../agent/boot';

/** `assistantJobRunning`, re-read whenever the assistant session changes. */
export function useAssistantJobRunning(): boolean {
  return useAgentSession(jobRunningIn);
}

/** The Help Center ranks above the frame; both editions hand it to the frame here. */
export { loadHelpModal, loadWhatsThisLayer } from '../help/loaders';
export { useContextHelp } from '../help/use-context-help';
