// src/io/share/errors.ts
export type ShareErrorCode =
  | 'not-an-image'          // bytes are not a recognized container (no PNG signature) / not decodable as one
  | 'no-payload'            // valid image, but no share code found in it
  | 'future-version'        // appVersion/payload version newer than this build can read
  | 'corrupt'               // integrity check failed, or untrusted input exceeded a safety cap
  | 'decode-failed'         // codec/raster decode threw
  | 'incompatible-template' // template unknown or dimensions differ
  | 'missing-catalog-item'  // a used catalog id does not exist here
  | 'validation-failed';    // structural validation rejected the map

export class ShareError extends Error {
  constructor(public readonly code: ShareErrorCode, message: string) {
    super(message);
    this.name = 'ShareError';
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
