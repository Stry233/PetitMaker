/** Whether the object shelf's brush button is still to be pointed out: the `brushHintSeen` pref. */
import { prefStorageAvailable, readPref, writePref } from '../../platform/storage/prefs';

/** True until the hint was seen; false where storage cannot be read, which could not remember it. */
export function brushHintOwed(): boolean {
  return prefStorageAvailable() && !readPref('brushHintSeen');
}

export function rememberBrushHintSeen(): void {
  writePref('brushHintSeen', true);
}
