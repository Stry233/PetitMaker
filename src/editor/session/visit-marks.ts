/** What a visit records about this browser: that it holds this build's warmed assets, and that the
 *  visitor dismissed the browser notice. The readings are `io/storage/splash-facts.ts` and
 *  `io/storage/browser-notice-facts.ts`. */
import { writePref } from '../../platform/storage/prefs';
import { splashTag } from '../../io/storage/splash-facts';

/** Records that this browser holds this build's assets, so the next visit skips the splash. */
export function markSplashDone(): void {
  writePref('splashDone', splashTag());
}

/** Records that the visitor dismissed the in-app or older-browser notice. */
export function rememberBrowserNoticeSeen(): void {
  writePref('inAppBrowserSeen', true);
}
