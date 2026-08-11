/**
 * Fetching and parsing the 3D scene chunk ahead of the view that needs it.
 *
 * The scene module is imported lazily so three stays out of the main bundle, which means the first
 * activation pays a network fetch plus a parse before any meshing can start. That is the longest
 * and most variable part of the entrance, and the only part that is pure waiting.
 *
 * WHEN IT MATTERS MOST IS A COLD LOAD WITH 3D AS THE SAVED VIEW. `Editor3DCanvas`'s own effect
 * cannot start the fetch any earlier than it runs, and it is a later sibling than `PixiCanvas`,
 * whose mount effect synchronously builds the whole 2D renderer first — so the download sat behind
 * work that session was never going to show. Started from the entry point instead, it overlaps
 * React's first mount and everything the 2D side does.
 *
 * Idempotent, and a failure clears the latch so the real `import()` still reports whatever it would
 * have: this is a head start, never the load itself.
 */
let started = false;

function fetchModule(): void {
  void import('./scene/scene').catch(() => { started = false; });
}

/**
 * Begin loading the scene chunk. `idle` defers to a quiet moment, for a session that opens in 2D
 * and may never ask for 3D at all; without it the fetch starts now, which is what a session opening
 * straight into 3D wants. A browser with no requestIdleCallback (Safari) gets a timeout.
 */
export function preloadScene3D({ idle = false }: { idle?: boolean } = {}): void {
  if (started) return;
  started = true;
  if (!idle) { fetchModule(); return; }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fetchModule, { timeout: 4000 });
  else setTimeout(fetchModule, 2000);
}
