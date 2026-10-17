// Shared shapes of the scan pipeline. Every stage takes and returns typed arrays; images are
// row-major with `width` samples per row.

/** An axis-aligned pixel rectangle, [x0, x1) by [y0, y1). */
export interface PixelRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A single-channel image. */
export interface GreyImage<T extends Float32Array | Uint8Array = Float32Array> {
  readonly width: number;
  readonly height: number;
  readonly data: T;
}

/** An RGBA image with 4 bytes per pixel, as decoders and canvases hand it over. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** A plane projective map, row-major 3 x 3: (x, y) goes to ((h0 x + h1 y + h2) / w, (h3 x + h4 y + h5) / w)
 *  with w = h6 x + h7 y + h8. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/**
 * The fixed map between a decoded frame's screen pixels and the flat ground plane at the zoom the
 * scan reads. Ground coordinates are rectified pixels from the calibration's ground origin.
 */
export interface Rectification {
  /** The decoded frame size the calibration is measured in. */
  readonly frame: { readonly width: number; readonly height: number };
  /** Ground to screen pixels. */
  readonly toScreen: Homography;
  /** Screen pixels to ground; the inverse of `toScreen`. */
  readonly toGround: Homography;
}

/** The rectified tile: `width` by `height` ground pixels with ground (0, 0) at tile pixel
 *  (`originX`, `originY`). */
export interface TileSpec {
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

/** One integer peak of a phase-correlation surface: content moved by (dx, dy). */
export interface ShiftCandidate {
  readonly dx: number;
  readonly dy: number;
  /** The peak height on the smoothed correlation surface, 1 for identical tiles. */
  readonly peak: number;
}

/** A translation estimate between two images: `b(x, y) ~ a(x - dx, y - dy)`. */
export interface ShiftEstimate {
  readonly dx: number;
  readonly dy: number;
  /** The smoothed correlation surface's value at the refined peak, 1 for identical tiles. */
  readonly response: number;
  /** Normalised cross-correlation of the two images over their overlap at the integer shift. */
  readonly ncc: number;
  /** The overlap as a share of the image area. */
  readonly overlap: number;
  /** The candidate's rank by peak height, 0 for the highest peak. */
  readonly rank: number;
}
