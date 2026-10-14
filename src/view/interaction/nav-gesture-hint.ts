/**
 * The one-time nudge for a browser that has taken right-drag for itself.
 *
 * Some browsers, and plenty of extensions, bind their own mouse gestures to a right-button drag.
 * A page cannot ask whether such a handler exists — there is no API for "is someone else listening"
 * — and suppressing `contextmenu`, `auxclick` and the `pointerdown` itself, which this app does,
 * has no effect on one. So the only honest signal is the gesture failing: a right press whose
 * release never comes back.
 *
 * On the first such failure the user is told where the alternatives are, once, and the answer is
 * remembered. Being a heuristic, it must never do anything but inform: it changes no binding and
 * blocks nothing.
 */
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { readPref, writePref } from '../../platform/storage/prefs';

let shownThisSession = false;

function alreadySeen(): boolean {
  return shownThisSession || readPref('navGestureHint');
}

/** Report a nav drag that was taken by something outside the page. */
export function noteNavGestureLost(): void {
  if (alreadySeen()) return;
  shownThisSession = true;
  writePref('navGestureHint', true);
  showToast(translate('nav.gesture_taken'), 'warning');
}
