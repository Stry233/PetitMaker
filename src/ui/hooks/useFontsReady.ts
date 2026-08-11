import { useEffect } from 'react';

/**
 * Run `cb` once the web fonts have finished loading. Text-fitting/measuring components take their
 * first measurement synchronously with whatever font is available, which may be a fallback whose
 * metrics differ from the real CJK/rounded face — so they re-fit when the real font lands.
 *
 * The single home for the `document.fonts.ready` idiom, cast and eslint-disable included, rather
 * than a copy of it in each measuring component. Fire-once, empty deps by design.
 */
export function useFontsReady(cb: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => cb());
  }, []);
}
