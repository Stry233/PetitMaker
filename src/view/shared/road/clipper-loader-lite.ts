import type ClipperLib from 'clipper-lib';
import clipperUrl from 'clipper-lib/clipper.js?url';

type ClipperWindow = Window & { ClipperLib?: typeof ClipperLib };

/** Lite ships one classic script, so the clipper arrives as a separate classic script that sets `window.ClipperLib`. */
export function loadClipper(): Promise<typeof ClipperLib> {
  const host = window as ClipperWindow;
  if (host.ClipperLib) return Promise.resolve(host.ClipperLib);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = clipperUrl;
    script.onload = () => {
      if (host.ClipperLib) resolve(host.ClipperLib);
      else reject(new Error('Clipper script did not register'));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Clipper script failed to load'));
    };
    document.head.appendChild(script);
  });
}
