/**
 * `load` run once and shared: every call while it is pending, or after it resolved, gets the same
 * promise. A rejection is forgotten, so the next call tries again (a chunk whose fetch failed is
 * fetched afresh rather than failing forever).
 */
export function memoLoad<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load().catch((error: unknown) => {
    pending = null;
    throw error;
  }));
}
