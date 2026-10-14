/** Thrown when a map's payload or its notes do not fit the densest share-code profile. Reading a
 *  share code throws `save/import-error.ts:ImportError`. */
export class ShareTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareTooLargeError';
  }
}

export interface ShareLimits {
  /** Max decompressed canonical save bytes. A maxed real map (~169x140 + dense objects)
   *  canonicalizes well under this; generous headroom while still bounding memory. */
  maxCanonicalBytes: number;
  /** Decompressed/compressed bomb guard; inflate aborts past this ratio. */
  maxInflateRatio: number;
  /** Pixel allocation limit shared by the PNG byte reader and the browser bitmap path. */
  maxRasterPixels?: number;
}

export const DEFAULT_LIMITS: ShareLimits = {
  maxCanonicalBytes: 24 * 1024 * 1024,
  maxInflateRatio: 1024,
  maxRasterPixels: 64 * 1024 * 1024,
};
