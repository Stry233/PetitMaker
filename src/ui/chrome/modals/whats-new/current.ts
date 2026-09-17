/** This browser's reading of the bundled release notes, and the record that it has read them. */
import { readPref, writePref } from '../../../../core/runtime/prefs';
import { LEGAL } from '../../../../legal/config';
import { docBody } from '../../../../legal/registry';
import { APP_VERSION } from '../../../../version';
import { notesSince, type ReleaseNotes } from './notes';

/** The version this browser last opened, or null before any visit recorded one. */
export function lastSeenVersion(): string | null {
  return readPref('lastSeenVersion') || null;
}

/** The notes owed for the current build in the reader's language; Chinese has its own, the rest read English. */
export function currentNotes(locale: string): ReleaseNotes[] {
  return notesSince(docBody('changelog', locale === 'zh' ? 'zh' : 'en', LEGAL), lastSeenVersion(), APP_VERSION);
}

export function recordSeenVersion(): void {
  writePref('lastSeenVersion', APP_VERSION);
}
