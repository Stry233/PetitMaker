/** What's new as a visit answers it: opened when its notes are due, and this version recorded read. */
import { APP_VERSION } from '../../platform/build/build-info';
import { writePref } from '../../platform/storage/prefs';
import { useEditorStore } from '../../state/store';

/** Records this version's notes read (`io/storage/seen-version-facts.ts:lastSeenVersion`). */
function recordSeenVersion(): void {
  writePref('lastSeenVersion', APP_VERSION);
}

/** What's new as the visit's greetings come up: the window opens when notes are `due`, else this
 *  version is recorded read, so its notes never open later. */
export function greetWhatsNew(due: boolean): void {
  if (due) useEditorStore.getState().setModal('whatsNew', true);
  else recordSeenVersion();
}

/** The visitor has read What's new: this version is recorded read and the window closes. */
export function closeWhatsNew(): void {
  recordSeenVersion();
  useEditorStore.getState().setModal('whatsNew', false);
}
