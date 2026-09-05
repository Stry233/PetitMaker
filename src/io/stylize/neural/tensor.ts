/*
 * tensor.ts — pixels to model input and back, with no browser API involved so the maths is testable.
 *
 * The students are fully convolutional with three 2x downsamplings, so they accept any size but
 * return a band cropped to multiples of 8; `modelSize` picks the input size that makes the output
 * land exactly on itself. Layout is NCHW, RGB, floats in 0..1, batch of one.
 */

export interface ModelSize { width: number; height: number }

/** The largest multiple-of-8 frame that fits inside the given one. */
export function modelSize(width: number, height: number): ModelSize {
  return { width: Math.max(8, width - (width % 8)), height: Math.max(8, height - (height % 8)) };
}

/** RGBA bytes (row-major, `srcWidth` wide) to a planar RGB float tensor of the given size, reading
 *  the top-left `size` region. */
export function rgbaToTensor(rgba: Uint8ClampedArray | Uint8Array, srcWidth: number, size: ModelSize): Float32Array {
  const { width, height } = size;
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * srcWidth + x) * 4;
      const d = y * width + x;
      out[d] = rgba[s]! / 255;
      out[plane + d] = rgba[s + 1]! / 255;
      out[2 * plane + d] = rgba[s + 2]! / 255;
    }
  }
  return out;
}

/** A planar RGB float tensor back to opaque RGBA bytes. Values are clamped to 0..1 first: a model's
 *  output overshoots by a fraction at hard edges. */
export function tensorToRgba(tensor: Float32Array, size: ModelSize): Uint8ClampedArray {
  const { width, height } = size;
  const plane = width * height;
  const out = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    out[i * 4] = tensor[i]! * 255;
    out[i * 4 + 1] = tensor[plane + i]! * 255;
    out[i * 4 + 2] = tensor[2 * plane + i]! * 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}
