/**
 * The one-time nudge for a browser that has taken right-drag for itself.
 *
 * Some browsers, and plenty of extensions, bind their own mouse gestures to a right-button drag.
 * A page cannot ask whether such a handler exists — there is no API for "is someone else listening"
 * — and suppressing `contextmenu`, `auxclick` and the `pointerdown` itself, which this app does,
 * has no effect on one. So the only honest signal is the gesture FAILING: a right press whose
 * release never comes back.
 *
 * On the first such failure the user is told where the alternatives are, once, and the answer is
 * remembered. Being a heuristic, it must never do anything but inform: it changes no binding and
 * blocks nothing.
 */
import { showToast } from '../../core/runtime/toast-bus';
import { translate } from '../../i18n/context';

const SEEN_KEY = 'petit.navGestureHintSeen';

let shownThisSession = false;

function alreadySeen(): boolean {
  if (shownThisSession) return true;
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // private mode / storage denied: the session guard above still holds it to once
  }
}

/** Report a nav drag that was taken by something outside the page. */
export function noteNavGestureLost(): void {
  if (alreadySeen()) return;
  shownThisSession = true;
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Not being able to remember is not a reason to stay silent now.
  }
  showToast(translate('nav.gesture_taken'), 'warning');
}

/** Test-only: forget that the hint was shown. */
export function __resetNavGestureHint(): void {
  shownThisSession = false;
  try { localStorage.removeItem(SEEN_KEY); } catch { /* nothing to forget */ }
}
