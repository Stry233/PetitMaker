/**
 * Device performance tiering — computed ONCE from device signals, no per-frame monitoring (cheap +
 * maintainable). Drives the renderers' resolution cap so low-end / high-DPI devices don't waste GPU
 * painting many more pixels than the screen can show.
 *
 * Why a DPR cap matters: a 3×-DPR phone renders 9× the pixels of a 1× display. Above ~2× the extra
 * sharpness is imperceptible but the per-frame rasterization/fill cost grows quadratically — the
 * single biggest source of dropped frames on phones/low-end laptops under a heavy map.
 */

/** Logical CPU cores (a decent proxy for device tier); defaults high so unknown devices aren't
 *  degraded. */
const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
/** Device memory in GB where the browser exposes it (Chromium only); else assume plenty. */
const memGB = (typeof navigator !== 'undefined' && (navigator as { deviceMemory?: number }).deviceMemory) || 8;

/** A weak, conservative low-end signal (few cores or little memory). Only ever LOWERS quality, never
 *  raises it, so a misclassified device just renders a touch softer — never broken. */
const isLowEndDevice = cores <= 4 || memGB <= 4;

/**
 * The resolution multiplier a canvas renderer should use: the device pixel ratio, capped so we never
 * render far more pixels than useful. Capped at 2 normally, 1.5 on low-end devices.
 */
export function maxRenderScale(): number {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(dpr, isLowEndDevice ? 1.5 : 2);
}
