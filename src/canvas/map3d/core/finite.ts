/** The index of the first non-finite value, or -1 when every value is finite. */
export function firstNonFinite(values: ArrayLike<number>): number {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return i;
  return -1;
}

/**
 * Development builds name the scene part that received a NaN or infinite coordinate. three.js only
 * reports a NaN bounding sphere later, from frustum culling, without saying which builder made it.
 */
export function assertFinite(what: string, values: ArrayLike<number>): void {
  if (!import.meta.env.DEV) return;
  const at = firstNonFinite(values);
  if (at >= 0) console.error(`[map3d] ${what} has a non-finite value at index ${at}:`, values[at]);
}
