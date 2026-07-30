// src/io/export/paint-types.ts
/** An RGBA pixel buffer (canvas ImageData-shaped) passed through the export pipeline. */
export interface PixelBuffer { data: Uint8ClampedArray; width: number; height: number }
