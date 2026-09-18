/**
 * Device performance tiering — computed ONCE from device signals, no per-frame monitoring (cheap +
 * maintainable). Drives the renderers' resolution cap so low-end / high-DPI devices don't waste GPU
 * painting many more pixels than the screen can show.
 *
 * Why a DPR cap matters: a 3×-DPR phone renders 9× the pixels of a 1× display. Above ~2× the extra
 * sharpness is imperceptible but the per-frame rasterization/fill cost grows quadratically — the
 * single biggest source of dropped frames on phones/low-end laptops under a heavy map.
 *
 * THREE TIERS: 2× normally, 1.5× on a low-end device, 1× where the GL probe reports a SOFTWARE
 * rasterizer. On a software rasterizer every pixel is CPU work, so a dpr-2 screen is four times the
 * fill of a dpr-1 one with no GPU to absorb it; a browser update blocklisting a GPU is enough to put
 * a machine there.
 */

import { IS_LITE } from './edition';
import { readPref } from './prefs';

/** Logical CPU cores (a decent proxy for device tier); defaults high so unknown devices aren't
 *  degraded. */
/** A weak, conservative low-end signal (few cores or little memory). Only ever LOWERS quality, never
 *  raises it, so a misclassified device just renders a touch softer — never broken. Read at call
 *  time: the values never change in a browser, and a test can then pin the machine it means. */
function isLowEndDevice(): boolean {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
  const memGB = (typeof navigator !== 'undefined' && (navigator as { deviceMemory?: number }).deviceMemory) || 8;
  return cores <= 4 || memGB <= 4;
}

/** What the renderers may afford on this device's GL. 'full' = hardware GL: soft shadows,
 *  in-app MSAA, the hardware DPR cap below. 'lite' = a SOFTWARE rasterizer (SwiftShader/llvmpipe — a
 *  blocklisted GPU or broken driver): every pixel is CPU work, so shadow maps and multisampling
 *  turn the view into seconds-per-frame; the scene drops both and renders at 1x. */
export type GlQuality = 'full' | 'lite';

let glQualityOverride: GlQuality | null = null;

/** Pin the probe's answer, for a caller that KNOWS better than the renderer string: the headless
 *  capture pipelines run on SwiftShader by choice and still want the shipped look. */
export function setGlQualityOverride(q: GlQuality | null): void {
  glQualityOverride = q;
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i;

let probedGlQuality: GlQuality | null = null;
let probedRenderer = '';

/** Probed ONCE per session from a throwaway context (released via WEBGL_lose_context). A device
 *  with no GL at all also reads 'lite' — the scene may still fail to build, which the canvas
 *  host handles separately; quality only has to never claim hardware where there is none. */
function probeGl(): GlQuality {
  if (probedGlQuality) return probedGlQuality;
  if (typeof document === 'undefined') return 'full';
  let quality: GlQuality = 'lite';
  try {
    const cnv = document.createElement('canvas');
    const gl = (cnv.getContext('webgl2') ?? cnv.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
      const renderer = String(
        (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null) ?? gl.getParameter(gl.RENDERER) ?? '',
      );
      probedRenderer = renderer;
      quality = SOFTWARE_GL.test(renderer) ? 'lite' : 'full';
      (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    quality = 'lite';
  }
  probedGlQuality = quality;
  return quality;
}

export function glQuality(): GlQuality {
  if (glQualityOverride) return glQualityOverride;
  // The user's Settings choice outranks the probe: a misread renderer string should not force
  // lite on a healthy GPU, and a software-GL user may willingly pay for the full picture.
  const pinned = readPref('quality3d');
  if (pinned !== 'auto') return pinned;
  return IS_LITE ? 'lite' : probeGl();
}

/** The unmasked renderer string the probe read, for the About modal's one diagnostic line: a
 *  "the editor is slow" report then carries what the machine is actually painting with, without
 *  asking its owner to open the browser's GPU page. Empty where there is no GL to name. */
export function glRendererName(): string {
  probeGl();
  return probedRenderer;
}

/**
 * The resolution multiplier a canvas renderer should use: the device pixel ratio, capped at this
 * device's tier (see the three tiers in the file header).
 *
 * The software tier reads `glQuality()`, so it carries both of that answer's overrides: the capture
 * pipelines pin 'full' and keep the hardware cap, and the Settings quality choice reaches the 2D
 * canvas as well as the 3D scene. The trade is a slightly softer picture on a hi-DPI screen and
 * none at all on a dpr-1 one; map CAPTURES are unaffected either way, since every one of them
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

let webgl2Probe: boolean | null = null;

/**
 * Whether this device has WebGL2 at all. three r169 is WebGL2-only, so the 3D view, its tour steps
 * and its scene preload ask here first: without it the scene build throws and the editor lands back
 * in 2D with a toast, which is a worse answer than never offering the view.
 *
 * Probed once from a throwaway context and released through WEBGL_lose_context, so the answer costs
 * neither a live context slot nor a second probe.
 */
export function hasWebGL2(): boolean {
  if (webgl2Probe !== null) return webgl2Probe;
  let ok = false;
  try {
    if (typeof document !== 'undefined') {
      const gl = document.createElement('canvas').getContext('webgl2');
      ok = !!gl;
      (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    ok = false;
  }
  webgl2Probe = ok;
  return ok;
}

/** Tests pin one machine per case; the probe answers once per session otherwise. */
export function __resetWebGL2Probe(): void {
  webgl2Probe = null;
}
