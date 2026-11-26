/** The version whose release notes this browser last read: the `lastSeenVersion` pref, written by
 *  `editor/session/whats-new.ts`. */
import { readPref } from '../../platform/storage/prefs';

/** The version this browser last opened, or null before any visit recorded one. */
export function lastSeenVersion(): string | null {
  return readPref('lastSeenVersion') || null;
}
