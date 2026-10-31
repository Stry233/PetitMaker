/**
 * An installed app enters immersive mode (page fullscreen) on its own: a browser grants fullscreen only
 * to a user gesture, so it enters on the first tap or key after it opens or returns to the screen,
 * unless the user turned it off with the Settings button (`prefs.ts:PREFS.installedImmersive`).
 */
import { readPref, writePref } from '../storage/prefs';
import { enterFullscreen, fullscreenAvailable, isFullscreen, isInstalledApp } from './fullscreen';

/** The events a browser counts as a user activation. */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * Arms the entry while the page runs as an installed app; returns the disarm. A launch or a return to
 * the screen arms it once, so leaving fullscreen with the system's own gesture holds until the app is
 * next brought back.
 */
export function installInstalledImmersive(): () => void {
  if (!fullscreenAvailable() || !isInstalledApp()) return () => {};
  let armed = readPref('installedImmersive');
  const onGesture = () => {
    if (!armed) return;
    armed = false;
    if (!isFullscreen()) void enterFullscreen();
  };
  const onShown = () => {
    if (document.visibilityState === 'visible') armed = readPref('installedImmersive') && !isFullscreen();
  };
  for (const type of GESTURES) window.addEventListener(type, onGesture, true);
  document.addEventListener('visibilitychange', onShown);
  return () => {
    for (const type of GESTURES) window.removeEventListener(type, onGesture, true);
    document.removeEventListener('visibilitychange', onShown);
  };
}

/** Whether this page enters immersive mode on its own (`installInstalledImmersive`). */
export function entersImmersiveItself(): boolean {
  return fullscreenAvailable() && isInstalledApp() && readPref('installedImmersive');
}

/** Records the choice the Settings button makes in an installed app: entering keeps the entry on,
 *  leaving turns it off. A tab records nothing. */
export function rememberImmersiveChoice(entering: boolean): void {
  if (isInstalledApp()) writePref('installedImmersive', entering);
}
