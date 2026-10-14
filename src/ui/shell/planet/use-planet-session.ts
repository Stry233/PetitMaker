/**
 * The planet session as the shell shows it: whether one may open now, and the name its planet is
 * shown under. The session itself is `editor/session/planet-editing.ts`.
 */
import { useSyncExternalStore } from 'react';
import type { Locale } from '../../../core/model/locale';
import {
  canStartPlanetEditing, onSessionLibraryChange, sessionLibraryPlace, type SessionLibraryPlace,
} from '../../../editor/session/planet-editing';
import { defaultPlanetName, shownEntryName } from '../../../editor/session/planet-names';
import { useAssistantJobRunning } from '../edition-surfaces';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { useLocale } from '../../../i18n/context';

/** `canStartPlanetEditing` for the live editor, updating as the store and the assistant job change. */
export function useCanStartPlanetEditing(): boolean {
  const jobRunning = useAssistantJobRunning();
  return useEditorStore((s) => canStartPlanetEditing(s, jobRunning));
}

/**
 * The session planet's name as shown: the edited entry's name once it has passed the text check,
 * otherwise its default name; for a new planet the next free default name.
 */
function shownSessionName(session: EditorStore['planetSession'], { entry, index, count }: SessionLibraryPlace, locale: Locale): string {
  if (entry) return shownEntryName(entry, index, locale);
  return session?.nameReviewed && session.name.trim() ? session.name : defaultPlanetName(locale, count);
}

/** `shownSessionName` for the nameplate: follows the locale, the session and the library. */
export function useSessionPlanetName(): string {
  const locale = useLocale();
  const session = useEditorStore((s) => s.planetSession);
  const place = useSyncExternalStore(onSessionLibraryChange, sessionLibraryPlace);
  return shownSessionName(session, place, locale);
}
