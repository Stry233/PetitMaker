/** Page fullscreen through the Fullscreen API: the immersive mode a browser tab offers without installation. */

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
  if (typeof document === 'undefined') return false;
  if (document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function') return true;
  // iPhone Safari has neither form, because its element fullscreen is for video only.
  return doc().webkitFullscreenEnabled === true && typeof root().webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return (document.fullscreenElement ?? doc().webkitFullscreenElement) != null;
}

/** Enters or leaves fullscreen; a refused request leaves the page as it is. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      if (typeof document.exitFullscreen === 'function') await document.exitFullscreen();
      else await doc().webkitExitFullscreen?.();
    } else if (typeof document.documentElement.requestFullscreen === 'function') {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else {
      // The prefixed call takes no options; Safari hides its own navigation anyway.
      await root().webkitRequestFullscreen?.();
    }
  } catch {
    // The engine refused, or the gesture did not qualify.
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
