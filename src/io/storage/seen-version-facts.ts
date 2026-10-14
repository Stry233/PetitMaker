/** The version whose release notes this browser last read: the `lastSeenVersion` pref. */
import { readPref, writePref } from '../../platform/storage/prefs';
import { APP_VERSION } from '../../platform/build/build-info';

/** The version this browser last opened, or null before any visit recorded one. */
export function lastSeenVersion(): string | null {
  return readPref('lastSeenVersion') || null;
}

export function recordSeenVersion(): void {
  writePref('lastSeenVersion', APP_VERSION);
}
