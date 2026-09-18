import { lazy } from 'react';
import { useAgentSession } from '../../agent/session/store';
import { isConnected, useAgentPanelSettings } from '../agent/settings';
export { CharacterHost } from '../agent/character/CharacterHost';
export { GenerateShelf } from './bars/GenerateShelf';
export { Windows } from './windows/Windows';
/** Keep the runner and provider SDKs behind the assistant’s first open. */
export const PanelColumn = lazy(() => import('../agent/PanelColumn'));
export function useAssistantConnected(): boolean { return useAgentPanelSettings(isConnected); }
export function clearAssistantSession(): void { useAgentSession.getState().clearSession(); }
