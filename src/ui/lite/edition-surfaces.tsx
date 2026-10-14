import type { ComponentProps } from 'react';
import type * as Web from '../shell/edition-surfaces';
export { LiteWindows as Windows } from './LiteWindows';
export function CharacterHost(_props: ComponentProps<typeof Web.CharacterHost>) { return null; }
/** The edition loads no panel or illustration chunk; its loaders resolve to nothing. */
export const loadPanelColumn: () => Promise<unknown> = () => Promise.resolve();
export const loadStylizeWindow: () => Promise<unknown> = () => Promise.resolve();
export function PanelColumn(_props: ComponentProps<typeof Web.PanelColumn>) { return null; }
export { GenerateShelf } from '../shell/bars/generate/GenerateShelf';
export const EDITION_WARM_FILES: typeof Web.EDITION_WARM_FILES = [];
export const useAssistantConnected: typeof Web.useAssistantConnected = () => false;
export const clearAssistantSession: typeof Web.clearAssistantSession = () => {};
export const assistantJobRunning: typeof Web.assistantJobRunning = () => false;
export const useAssistantJobRunning: typeof Web.useAssistantJobRunning = () => false;
export { loadHelpModal, loadWhatsThisLayer } from '../help/loaders';
export { useContextHelp } from '../help/use-context-help';
