/**
 * Pure helpers for the Ctrl+(+/-) UI-zoom accumulator. Kept import-free so they
 * are trivially unit-testable and safe to pull into the main bundle.
 */

/** Clamp + 2-decimal-round a UI-zoom value, matching the store's setUiZoom. */
export const clampUiZoom = (z: number): number => Math.max(0.6, Math.min(1.8, +z.toFixed(2)));

/** Next value of an exponential-smoothing follow toward target (one frame step). */
export const followStep = (cur: number, target: number, k = 0.2): number => cur + (target - cur) * k;
