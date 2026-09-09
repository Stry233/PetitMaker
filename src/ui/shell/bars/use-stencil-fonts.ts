import { useEffect, useState } from 'react';
import { ensureGlyphFonts, glyphFontsReady } from './stencil-raster';

/** A null input needs no fonts; a replaced input cannot complete another card's readiness. */
export function useStencilFonts(text: string | null): boolean {
  const [loadedText, setLoadedText] = useState<string | null>(null);
  useEffect(() => {
    if (text === null || glyphFontsReady(text)) return;
    let dropped = false;
    void ensureGlyphFonts(text).then(() => { if (!dropped) setLoadedText(text); });
    return () => { dropped = true; };
  }, [text]);
  return text === null || loadedText === text || glyphFontsReady(text);
}
