/**
 * Pure helpers for the Ctrl+(+/-) UI-zoom accumulator. The clamp a stored value takes is
 * `core/runtime/prefs.ts:clampUiZoom`.
 */

/** Next value of an exponential-smoothing follow toward target (one frame step). */
export const followStep = (cur: number, target: number, k = 0.2): number => cur + (target - cur) * k;
