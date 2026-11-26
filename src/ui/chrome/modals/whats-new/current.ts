/** The bundled release notes this browser has not read yet; the record of what it read is
 *  `io/storage/seen-version-facts.ts`. */
import { lastSeenVersion } from '../../../../io/storage/seen-version-facts';
import { LEGAL } from '../../../../legal/config';
import { docBody } from '../../../../legal/registry';
import { APP_VERSION } from '../../../../platform/build/build-info';
import { notesSince, type ReleaseNotes } from '../../../../state/greetings';

/** The language the notes are written in for a reader: Chinese has its own, the rest read English. */
export function notesLanguage(locale: string): 'en' | 'zh' {
  return locale === 'zh' ? 'zh' : 'en';
}

/** The bundled changelog's text in the reader's language. */
export function changelogText(locale: string): string {
  return docBody('changelog', notesLanguage(locale), LEGAL);
}

/** The notes owed for the current build in the reader's language. */
export function currentNotes(locale: string): ReleaseNotes[] {
  return notesSince(changelogText(locale), lastSeenVersion(), APP_VERSION);
}
