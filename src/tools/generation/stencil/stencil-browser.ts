/**
 * The browser a stencil is drawn and decoded in, supplied by the editor that runs the shelf. Without
 * one the raster gates answer "cannot measure" and plans come back empty, never a crash.
 */

/** A decoded picture, with its natural size. */
export type DecodedImage = CanvasImageSource & { width: number; height: number };

export interface StencilBrowser {
  /** A 2D context on a fresh `width` x `height` canvas that is read back often, or null. */
  canvas(width: number, height: number): CanvasRenderingContext2D | null;
  /** The document's font set, for loading and checking the glyph faces; null where there is none. */
  fonts(): Pick<FontFaceSet, 'check' | 'load'> | null;
  /** Decodes the picture at `src`. */
  loadImage(src: string): Promise<DecodedImage>;
}

let browser: StencilBrowser | null = null;

/** Installs the browser stencils use; returns the uninstall. */
export function installStencilBrowser(next: StencilBrowser): () => void {
  browser = next;
  return () => { if (browser === next) browser = null; };
}

export function stencilBrowser(): StencilBrowser | null {
  return browser;
}
