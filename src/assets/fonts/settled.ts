/** The page's web-font load signal, kept out of `faces.ts` so its readers import no font file (Lite ships none). */

/**
 * Calls `listener` once the fonts loading now have settled and again after each later batch of
 * loads settles (on a cold visit the faces register only after the splash's art); returns the
 * unsubscribe. `document.fonts.ready` alone would miss the later batches.
 */
export function onFontsSettled(listener: () => void): () => void {
  const fonts = typeof document !== 'undefined' ? document.fonts as FontFaceSet | undefined : undefined;
  if (!fonts) return () => {};
  let live = true;
  const notify = (): void => { if (live) listener(); };
  void fonts.ready?.then(notify);
  fonts.addEventListener?.('loadingdone', notify);
  return () => { live = false; fonts.removeEventListener?.('loadingdone', notify); };
}
