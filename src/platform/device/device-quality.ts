/**
 * Device performance tiering — computed once from device signals, no per-frame monitoring (cheap +
 * maintainable). Drives the renderers' resolution cap so low-end / high-DPI devices don't waste GPU
 * painting many more pixels than the screen can show.
 *
 * Why a DPR cap matters: a 3×-DPR phone renders 9× the pixels of a 1× display. Above ~2× the extra
 * sharpness is imperceptible but the per-frame rasterization/fill cost grows quadratically — the
 * single biggest source of dropped frames on phones/low-end laptops under a heavy map.
 *
 * Three tiers: 2× normally, 1.5× on a low-end device, 1× where the GL probe reports a software
 * rasterizer. On a software rasterizer every pixel is CPU work, so a dpr-2 screen is four times the
 * fill of a dpr-1 one with no GPU to absorb it; a browser update blocklisting a GPU is enough to put
 * a machine there.
 */

import { IS_LITE } from '../build/edition';
import { readPref } from '../storage/prefs';

/** A weak, conservative low-end signal (few cores or little memory). Only ever lowers quality, never
 *  raises it, so a misclassified device just renders a touch softer — never broken. Read at call
 *  time: the values never change in a browser, and a test can then pin the machine it means. */
function isLowEndDevice(): boolean {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
  const memGB = (typeof navigator !== 'undefined' && (navigator as { deviceMemory?: number }).deviceMemory) || 8;
  return cores <= 4 || memGB <= 4;
}

/**
 * How much of the app a visit fetches ahead of use, right after its first paint (or inside the cold
 * splash). 'full': every lazy chunk, the first-use files (map check and text check runtimes, sample
 * pictures, the video guide) and one on-device illustration runtime with the default style's weights.
 * 'core': the same without the illustration runtime, for a device with little memory or few cores.
 * 'minimal': the 3D view and Help code only, on a slow connection. 'none': nothing, where the visitor
 * asked to save data and in the offline edition, which carries everything in its one file.
 *
 * Every tier fetches bytes into the HTTP cache only: nothing is decoded or instantiated ahead of use.
 */
export type WarmTier = 'full' | 'core' | 'minimal' | 'none';

const SLOW_CONNECTION = /^(?:slow-2g|2g|3g)$/;

export function warmTier(): WarmTier {
  if (IS_LITE) return 'none';
  const connection = typeof navigator !== 'undefined'
    ? (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    : undefined;
  if (connection?.saveData) return 'none';
  if (SLOW_CONNECTION.test(connection?.effectiveType ?? '')) return 'minimal';
  return isLowEndDevice() ? 'core' : 'full';
}

/** What the renderers may afford on this device's GL. 'full' = hardware GL: soft shadows,
 *  in-app MSAA, the hardware DPR cap below. 'lite' = a software rasterizer (SwiftShader/llvmpipe — a
 *  blocklisted GPU or broken driver): every pixel is CPU work, so shadow maps and multisampling
 *  turn the view into seconds-per-frame; the scene drops both and renders at 1x. */
export type GlQuality = 'full' | 'lite';

let glQualityOverride: GlQuality | null = null;

/** Pin the probe's answer, for a caller that knows better than the renderer string: the headless
 *  capture pipelines run on SwiftShader by choice and still want the shipped look. */
export function setGlQualityOverride(q: GlQuality | null): void {
  glQualityOverride = q;
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i;

/** What one throwaway GL context told us: whether it was WebGL2, whether it can render (a context
 *  reporting no fragment uniforms cannot), and its renderer string, null where none was read. */
interface GlProbe { webgl2: boolean; usable: boolean; renderer: string | null }

/** The one GL probe of the page, answered once: a probe can cost close to a second on a software
 *  rasterizer. */
let glProbe: GlProbe | null = null;

/** Probed once per session from a throwaway context, released through WEBGL_lose_context so it
 *  holds none of the browser's limited live-context slots. */
function probeGlContext(): GlProbe {
  if (glProbe) return glProbe;
  const found: GlProbe = { webgl2: false, usable: false, renderer: null };
  try {
    const cnv = document.createElement('canvas');
    const gl2 = cnv.getContext('webgl2');
    const gl = (gl2 ?? cnv.getContext('webgl')) as WebGLRenderingContext | null;
    found.webgl2 = !!gl2;
    if (gl) {
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
        found.renderer = String(
          (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null) ?? gl.getParameter(gl.RENDERER) ?? '',
        );
        found.usable = (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number) > 0;
      } catch {
        // A context that cannot answer for itself is neither usable nor known hardware.
      }
      (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    // No canvas or no GL: every answer stays no.
  }
  glProbe = found;
  return found;
}

/** A device with no GL at all also reads 'lite': the scene may still fail to build, which the
 *  canvas host handles separately; quality only has to never claim hardware where there is none. */
function probeGl(): GlQuality {
  if (typeof document === 'undefined') return 'full';
  const { renderer } = probeGlContext();
  return renderer === null || SOFTWARE_GL.test(renderer) ? 'lite' : 'full';
}

export function glQuality(): GlQuality {
  if (glQualityOverride) return glQualityOverride;
  // The user's Settings choice outranks the probe: a misread renderer string should not force
  // lite on a healthy GPU, and a software-GL user may willingly pay for the full picture.
  const pinned = readPref('quality3d');
  if (pinned !== 'auto') return pinned;
  return IS_LITE ? 'lite' : probeGl();
}

/**
 * The resolution multiplier a canvas renderer should use: the device pixel ratio, capped at this
 * device's tier (see the three tiers in the file header).
 *
 * The software tier reads `glQuality()`, so it carries both of that answer's overrides: the capture
 * pipelines pin 'full' and keep the hardware cap, and the Settings quality choice reaches the 2D
 * canvas as well as the 3D scene. The trade is a slightly softer picture on a hi-DPI screen and
 * none at all on a dpr-1 one; map captures are unaffected either way, since every one of them
 * renders into a render texture at its own explicitly computed resolution.
 */
export function maxRenderScale(surface?: { width: number; height: number; budgetScale: number }): number {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (IS_LITE) {
    const pixels = surface ? Math.max(1, surface.width * surface.height) : typeof window === 'undefined' ? 1 : Math.max(1, window.innerWidth * window.innerHeight);
    const initial = Math.min(dpr, 1, Math.sqrt(1_000_000 / pixels));
    const ceiling = Math.min(dpr, isLowEndDevice() ? 1.5 : 2, Math.sqrt(8_000_000 / pixels));
    return Math.min(ceiling, initial * (surface?.budgetScale ?? 1));
  }
  if (glQuality() === 'lite') return Math.min(dpr, 1);
  return Math.min(dpr, isLowEndDevice() ? 1.5 : 2);
}

/** Higher resolution is earned by measured headroom, never by browser version. */
export function canIncreaseRenderScale(): boolean {
  return IS_LITE && readPref('quality3d') !== 'lite' && !isLowEndDevice() && probeGl() === 'full';
}

/**
 * Whether this device has WebGL2 at all. three r169 is WebGL2-only, so the 3D view, its tour steps
 * and its scene preload ask here first: without it the scene build throws and the editor lands back
 * in 2D with a toast, which is a worse answer than never offering the view.
 */
export function hasWebGL2(): boolean {
  return probeGlContext().webgl2;
}

/** Whether a WebGL context (2 or 1) can render here; the 2D renderer falls back to Canvas2D without
 *  one. */
export function hasUsableWebGL(): boolean {
  return probeGlContext().usable;
}

/** Tests pin one machine per case; the probe answers once per session otherwise. */
export function __resetGlProbe(): void {
  glProbe = null;
}
