/**
 * The touch loupe's picture from the 2D scene: the square of the canvas under the finger drawn at the
 * loupe's own device pixels, so it is as sharp as the map at that scale rather than the frame's pixels
 * enlarged. Only the chunks the square reaches are drawn, its render target, read-back buffer, output
 * canvas and transform are kept from one frame to the next, and all of them go when the loupe hides.
 * WebGL only: on the Canvas2D renderer a second raster of the scene is CPU work, so that renderer
 * lends its drawn pixels instead (`view/shared/overlay/loupe.ts`).
 */
import * as PIXI from 'pixi.js-legacy';

/** The square of the canvas the loupe shows, in css px: top left (`x`, `y`), side `side`. */
export interface LoupeSquare { x: number; y: number; side: number }

interface Output { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; read: Uint8Array; image: ImageData }

export class LoupeRegion {
  private target: PIXI.RenderTexture | null = null;
  private output: Output | null = null;
  private readonly transform = new PIXI.Matrix();

  /** `cullTo` shows only the chunks a square reaches while it renders; null restores the camera's. */
  constructor(
    private readonly renderer: PIXI.Renderer,
    private readonly stage: PIXI.Container,
    private readonly cullTo: (square: LoupeSquare | null) => void,
  ) {}

  /** `square` drawn into `outPx` device px, or null where it could not be drawn. */
  render(square: LoupeSquare, outPx: number): HTMLCanvasElement | null {
    if (outPx <= 0 || square.side <= 0) return null;
    const target = this.targetOf(outPx);
    const output = this.outputOf(outPx);
    if (!output) return null;
    const k = outPx / square.side;
    this.transform.set(k, 0, 0, k, -square.x * k, -square.y * k);
    this.cullTo(square);
    try {
      this.renderer.render(this.stage, { renderTexture: target, clear: true, transform: this.transform });
      // Cleared to the opaque background, so every pixel is opaque and the premultiplied read-back
      // is already the straight colour ImageData expects. Rows come top first from a render texture.
      this.renderer.renderTexture.bind(target);
      const gl = this.renderer.gl;
      gl.readPixels(0, 0, outPx, outPx, gl.RGBA, gl.UNSIGNED_BYTE, output.read);
      output.ctx.putImageData(output.image, 0, 0);
      return output.canvas;
    } catch {
      return null;
    } finally {
      this.cullTo(null);
    }
  }

  /** Frees the target and buffers; the next render makes them again. */
  release(): void {
    this.target?.destroy(true);
    this.target = null;
    this.output = null;
  }

  private targetOf(outPx: number): PIXI.RenderTexture {
    if (this.target && this.target.width === outPx) return this.target;
    this.target?.destroy(true);
    const target = PIXI.RenderTexture.create({ width: outPx, height: outPx, resolution: 1 });
    target.baseTexture.clearColor = this.renderer.background.color;
    this.target = target;
    return target;
  }

  private outputOf(outPx: number): Output | null {
    if (this.output && this.output.canvas.width === outPx) return this.output;
    const canvas = document.createElement('canvas');
    canvas.width = outPx;
    canvas.height = outPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(outPx, outPx);
    this.output = { canvas, ctx, read: new Uint8Array(image.data.buffer), image };
    return this.output;
  }
}
