/** Whether the visitor dismissed the in-app or older-browser notice (the `inAppBrowserSeen` pref,
 *  written by `editor/session/visit-marks.ts:rememberBrowserNoticeSeen`), and whether this browser
 *  is owed it. */
import { isInAppBrowser, zoomedRectsAreVisual } from '../../platform/device/browser-env';
import { readPref } from '../../platform/storage/prefs';

function browserNoticeSeen(): boolean {
  return readPref('inAppBrowserSeen');
}

/** Whether the browser notice is owed: an app's built-in view or an engine that measures zoomed
 *  subtrees in their own pixels, until the visitor dismissed it. Both readings are guesses. */
export function browserNoticeDue(): boolean {
  return (isInAppBrowser() || !zoomedRectsAreVisual()) && !browserNoticeSeen();
}
