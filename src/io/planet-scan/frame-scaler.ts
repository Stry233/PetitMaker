/**
 * Draws decoded video frames at the scan's frame size and reads them back as RGBA, off the main
 * thread on an `OffscreenCanvas`.
 *
 * WebGL 2 scales on the GPU with a box filter: each output pixel averages ceil(scale) x ceil(scale)
 * bilinear taps spread over its footprint, which for a whole-number scale (1080p and 4K to
 * 960 x 540) lands every tap on a texel centre and is the exact area average. The frame is read back
 * into one buffer that every draw reuses, so reading thousands of frames leaves nothing to collect;
 * a 2D canvas returns a new frame-sized image each time, garbage the collector lets pile up far
 * above the live memory. The 2D canvas is the fallback where WebGL 2 is missing, and takes over
 * when a lost WebGL context cannot be rebuilt. Colours are the browser's conversion of the frame's
 * colour space in both.
 */
import type { Placement } from './framing';
import type { RgbaImage } from './types';

/** Draws a frame placed at `at` (`framing.ts`); the image it returns is valid until the next draw. */
export type FrameScaler = (frame: VideoFrame, at: Placement) => RgbaImage;

/** The most taps a side the box filter takes: enough for an 8K frame. */
const MAX_TAPS = 8;

const VERTEX = `#version 300 es
void main() {
  // One triangle over the whole viewport.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Output row 0 (the bottom of the viewport, read back first) samples texture row 0 (the top of the
// picture), so the rows come back top first.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 sourceSize;
uniform vec2 origin;
uniform vec2 scale;
uniform ivec2 taps;
out vec4 colour;
void main() {
  vec2 centre = origin + gl_FragCoord.xy * scale;
  // Frame pixels outside the picture stay black.
  if (any(lessThan(centre, vec2(0.0))) || any(greaterThan(centre, sourceSize))) { colour = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 sum = vec4(0.0);
  for (int j = 0; j < ${MAX_TAPS}; j++) {
    if (j >= taps.y) break;
    for (int i = 0; i < ${MAX_TAPS}; i++) {
      if (i >= taps.x) break;
      vec2 offset = ((vec2(float(i), float(j)) + 0.5) / vec2(taps) - 0.5) * scale;
      sum += texture(source, (centre + offset) / sourceSize);
    }
  }
  colour = vec4((sum / float(taps.x * taps.y)).rgb, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** A WebGL 2 scaler at `width` x `height`, or null where WebGL 2 or its shaders are unavailable. A
 *  lost context is rebuilt once; after that the 2D canvas draws. */
export function webglScaler(width: number, height: number): FrameScaler | null {
  let draw = buildWebgl(width, height);
  if (!draw) return null;
  let rebuilt = false;
  return (frame, at) => {
    try {
      return draw!(frame, at);
    } catch (error) {
      if (!(error instanceof ContextLost)) throw error;
      const next = rebuilt ? null : buildWebgl(width, height);
      rebuilt = true;
      draw = next ?? canvasScaler(width, height);
      if (!draw) throw error;
      return draw(frame, at);
    }
  };
}

class ContextLost extends Error {
  constructor() {
    super('the graphics context was lost');
    this.name = 'ContextLost';
  }
}

function buildWebgl(width: number, height: number): FrameScaler | null {
  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl || gl.isContextLost()) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'source'), 0);
  const sourceSize = gl.getUniformLocation(program, 'sourceSize');
  const origin = gl.getUniformLocation(program, 'origin');
  const scale = gl.getUniformLocation(program, 'scale');
  const taps = gl.getUniformLocation(program, 'taps');
  gl.viewport(0, 0, width, height);
  const out = new Uint8Array(width * height * 4);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let size = { w: 0, h: 0 };
  let placed: Placement | null = null;
  return (frame, at) => {
    if (gl.isContextLost()) throw new ContextLost();
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (w !== size.w || h !== size.h || at !== placed) {
      const step = 1 / at.scale;
      gl.uniform2f(sourceSize, w, h);
      gl.uniform2f(origin, -at.x * step, -at.y * step);
      gl.uniform2f(scale, step, step);
      const n = Math.min(MAX_TAPS, Math.max(1, Math.ceil(step - 1e-6)));
      gl.uniform2i(taps, n, n);
      size = { w, h };
      placed = at;
    }
    // A whole upload each frame: Chromium copies a video frame into a texture it allocates on the GPU,
    // while refilling immutable storage (`texStorage2D` and `texSubImage2D`) takes a slower path.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    if (gl.isContextLost()) throw new ContextLost();
    return { width, height, data: out };
  };
}

/** A 2D canvas scaler at `width` x `height`, or null without a 2D context. */
export function canvasScaler(width: number, height: number): FrameScaler | null {
  const canvas = new OffscreenCanvas(width, height);
  // A GPU canvas scales where the frame was decoded and reads back only the small frame; a CPU
  // canvas (`willReadFrequently`) reads the whole picture back first, several times slower.
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return (frame, at) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(frame, at.x, at.y, frame.displayWidth * at.scale, frame.displayHeight * at.scale);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  };
}
