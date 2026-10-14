/** Whether this browser has warmed this build's assets: the `splashDone` pref, tagged per build. */
import { readPref, writePref } from '../../platform/storage/prefs';
import { APP_VERSION, BUILD_SHA } from '../../platform/build/build-info';
import { supportsLosslessWebp } from '../../assets/image-format';

/** A decoder change selects different immutable assets even within the same build. */
function splashTag(): string {
  return `${APP_VERSION}#${BUILD_SHA}#${supportsLosslessWebp ? 'webp' : 'png'}`;
}

export function shouldShowSplash(): boolean {
  return readPref('splashDone') !== splashTag();
}

export function markSplashDone(): void {
  writePref('splashDone', splashTag());
}
