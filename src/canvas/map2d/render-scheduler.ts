/**
 * render-scheduler.ts — module-level render request, mirroring motion-state's
 * singleton pattern (one bundle, no window bridge).
 *
 * The PixiJS app does not auto-render every frame (autoStart:false). Instead
 * anything that mutates the scene — an edit, a viewport change, or a frame of a
 * canvas animation — calls `requestRender()`, which opens a short render window
 * in MapRenderer. A static editor therefore costs ~no GPU, freeing the frame
 * budget for DOM/Framer entrance animations; it ramps back to 60fps the instant
 * the canvas actually changes.
 *
 * A SET of requesters, not a slot: the editor's map is the standing instance, and
 * a Help figure mounts a second, short-lived `MapRenderer` over its own demo
 * world. Each instance detaches ITS OWN entry on destroy; a slot made the
 * figure's teardown silence the editor for good.
 *
 * A layer asks its OWN renderer: `MapRenderer` binds every layer's `requestRender`
 * field to itself right after constructing it, so a demo figure's animation opens
 * only that figure's render window, never the standing editor's (or every other
 * figure's) alongside it. This module function remains the broadcast for a caller
 * with no renderer reference at all (kit, tools, io, the agent's snapshotter) and
 * the fallback default a layer's field starts with before anything wires it.
 *
 * It is coalesced + idempotent — safe to call many times per frame (the loop
 * renders at most once per frame). When no renderer is registered (tests), it is
 * a no-op.
 */

const requesters = new Set<() => void>();

/** Register a renderer's render-window opener; returns its own detach. */
export function addRenderRequester(fn: () => void): () => void {
  requesters.add(fn);
  return () => { requesters.delete(fn); };
}

/** Ask every live renderer to draw the next few frames. Cheap, coalesced, spam-safe. */
export function requestRender(): void {
  for (const fn of requesters) fn();
}
