/**
 * The planet session as the shell shows it: whether one may open now, and the name its planet is
 * shown under. The session itself is `editor/session/planet-editing.ts`.
 */
import { useSyncExternalStore } from 'react';
import { canStartPlanetEditing, onSessionLibraryChange, sessionLibraryPlace } from '../../../editor/session/planet-editing';
import { shownSessionName } from '../../../editor/session/planet-names';
import { useAssistantJobRunning } from '../edition-surfaces';
import { useEditorStore } from '../../../state/store';
import { useLocale } from '../../../i18n/context';

/** `canStartPlanetEditing` for the live editor, updating as the store and the assistant job change. */
export function useCanStartPlanetEditing(): boolean {
  const jobRunning = useAssistantJobRunning();
  return useEditorStore((s) => canStartPlanetEditing(s, jobRunning));
}

/** `editor/session/planet-names.ts:shownSessionName` for the nameplate: follows the locale, the session and the library. */
export function useSessionPlanetName(): string {
  const locale = useLocale();
  const session = useEditorStore((s) => s.planetSession);
  const place = useSyncExternalStore(onSessionLibraryChange, sessionLibraryPlace);
  return shownSessionName(session, place, locale);
}
