/** Whether this browser has warmed this build's assets: the `splashDone` pref, tagged per build and
 *  written by `editor/session/visit-marks.ts:markSplashDone`. */
import { readPref } from '../../platform/storage/prefs';
import { APP_VERSION, BUILD_SHA } from '../../platform/build/build-info';
import { supportsLosslessWebp } from '../../assets/image-format';

/** The tag a warmed browser records: a decoder change selects different immutable assets even
 *  within the same build. */
export function splashTag(): string {
  return `${APP_VERSION}#${BUILD_SHA}#${supportsLosslessWebp ? 'webp' : 'png'}`;
}

export function shouldShowSplash(): boolean {
  return readPref('splashDone') !== splashTag();
}
