/**
 * The development check of render on demand: every visible change calls `requestRender()`, so a
 * scene at rest draws what it last painted. When the render window closes, the last frame's pixels
 * are fingerprinted; after a stretch of rest with no paint, the scene is drawn once more and a
 * different fingerprint names a change that reached the scene without a request. Development
 * servers only; a production view rests until something asks it to draw.
 */
/** How long a scene rests before the check redraws it, in ms. */
const REST_MS = 1000;

/** On in a development server, off in tests (whose renderers stub the drawing) and in builds. */
export const MISSED_RENDER_CHECK = import.meta.env.DEV && import.meta.env.MODE !== 'test';

/** The pixels a frame read returns, row-major RGBA. */
export type FramePixels = ArrayLike<number>;

/**
 * Reads `view`'s last frame through a copy on `scratch`, never from `view` itself: Chrome moves a
 * Canvas2D canvas that answers repeated `getImageData` calls off the GPU, and the software raster
 * that draws its next frame filters images differently, so reading the view would change the
 * pixels this check compares.
 */
export function viewFrameReader(
  view: HTMLCanvasElement, scratch: HTMLCanvasElement = document.createElement('canvas'),
): () => FramePixels {
  let ctx: CanvasRenderingContext2D | null = null;
  return () => {
    const { width, height } = view;
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width;
      scratch.height = height;
    }
    ctx ??= scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx || width === 0 || height === 0) return [];
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(view, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
}

function fingerprint(pixels: FramePixels): number {
  // FNV-1a over every byte: a one-pixel change moves it.
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) h = Math.imul(h ^ pixels[i]!, 0x01000193);
  return h >>> 0;
}

export class MissedRenderCheck {
  private signature: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private warned = false;

  /** @param readFrame the view's last drawn frame, from {@link viewFrameReader}. */
  constructor(private readonly readFrame: () => FramePixels, private readonly draw: () => void) {}

  /** The window closed on a frame just painted: fingerprint it and arm the rest check. */
  rested(): void {
    this.cancel();
    if (this.warned) return;
    this.signature = fingerprint(this.readFrame());
    this.timer = setTimeout(() => {
      this.timer = null;
      const before = this.signature;
      this.draw();
      if (before !== null && fingerprint(this.readFrame()) !== before) {
        this.warned = true;
        console.warn('MapRenderer: the scene changed at rest without a requestRender() call');
      }
    }, REST_MS);
  }

  /** A paint or a hide: the frame the check holds is no longer the one on screen. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.signature = null;
  }
}
