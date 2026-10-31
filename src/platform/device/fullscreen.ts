/** Page fullscreen through the Fullscreen API: the immersive mode a browser tab offers without installation. */

import { SUPPORTS_FULLSCREEN } from '../build/edition';

/** The `webkit`-prefixed calls Safari and WKWebView expose before 16.4. */
interface PrefixedDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => unknown;
}
interface PrefixedElement {
  webkitRequestFullscreen?: () => unknown;
}

const doc = (): Document & PrefixedDocument => document;
const root = (): HTMLElement & PrefixedElement => document.documentElement;

export function fullscreenAvailable(): boolean {
  if (!SUPPORTS_FULLSCREEN || typeof document === 'undefined') return false;
  if (document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function') return true;
  // iPhone Safari has neither form, because its element fullscreen is for video only.
  return doc().webkitFullscreenEnabled === true && typeof root().webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  if (!SUPPORTS_FULLSCREEN || typeof document === 'undefined') return false;
  return (document.fullscreenElement ?? doc().webkitFullscreenElement) != null;
}

/** Whether the page runs as an installed app (a home-screen or desktop install) rather than in a tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const shown = (mode: string) => typeof window.matchMedia === 'function' && window.matchMedia(`(display-mode: ${mode})`).matches;
  // iOS reports a home-screen app through `navigator.standalone` alone before 16.4.
  return shown('standalone') || shown('fullscreen') || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Enters fullscreen; it needs a user gesture, and a refused request leaves the page as it is. */
export async function enterFullscreen(): Promise<void> {
  if (!SUPPORTS_FULLSCREEN || isFullscreen()) return;
  try {
    if (typeof document.documentElement.requestFullscreen === 'function') {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else {
      // The prefixed call takes no options; Safari hides its own navigation anyway.
      await root().webkitRequestFullscreen?.();
    }
  } catch {
    // The engine refused, or the gesture did not qualify.
  }
}

/** Enters or leaves fullscreen; a refused request leaves the page as it is. */
export async function toggleFullscreen(): Promise<void> {
  if (!SUPPORTS_FULLSCREEN) return;
  if (!isFullscreen()) { await enterFullscreen(); return; }
  try {
    if (typeof document.exitFullscreen === 'function') await document.exitFullscreen();
    else await doc().webkitExitFullscreen?.();
  } catch {
    // The engine refused.
  }
}

/** Subscribes to entering and leaving fullscreen, including the browser's own exit gesture. */
export function onFullscreenChange(tell: () => void): () => void {
  document.addEventListener('fullscreenchange', tell);
  document.addEventListener('webkitfullscreenchange', tell);
  return () => {
    document.removeEventListener('fullscreenchange', tell);
    document.removeEventListener('webkitfullscreenchange', tell);
  };
}
