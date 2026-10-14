/** Whether the visitor dismissed the in-app or older-browser notice: the `inAppBrowserSeen` pref. */
import { readPref, writePref } from '../../platform/storage/prefs';

export function browserNoticeSeen(): boolean {
  return readPref('inAppBrowserSeen');
}

export function rememberBrowserNoticeSeen(): void {
  writePref('inAppBrowserSeen', true);
}
