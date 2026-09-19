// This lossless 2×1 WebP includes an opaque pixel and a transparent pixel.
const PROBE = 'data:image/webp;base64,UklGRhwAAABXRUJQVlA4TBAAAAAvAQAAEA8Q8x/zH4yM6H8A';

export let supportsLosslessWebp = false;
let readiness: Promise<void> | undefined;

/** Settle the format before evaluating modules that export artwork URLs. */
export function prepareImageFormat(): Promise<void> {
  return readiness ??= new Promise<void>((resolve) => {
    let settled = false;
    const image = new Image();
    const finish = (supported: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      supportsLosslessWebp = supported;
      resolve();
    };
    // A decoder that never dispatches an event must still reach the PNG entry path.
    const timer = setTimeout(() => finish(false), 1500);
    image.onload = () => finish(image.naturalWidth === 2 && image.naturalHeight === 1);
    image.onerror = () => finish(false);
    image.src = PROBE;
  });
}
