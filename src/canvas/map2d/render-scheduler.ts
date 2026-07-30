/**
 * render-scheduler.ts — module-level render request, mirroring motion-state's
 * singleton pattern (one bundle, one renderer, no window bridge).
 *
 * The PixiJS app does not auto-render every frame (autoStart:false). Instead
 * anything that mutates the scene — an edit, a viewport change, or a frame of a
 * canvas animation — calls `requestRender()`, which opens a short render window
 * in MapRenderer. A static editor therefore costs ~no GPU, freeing the frame
 * budget for DOM/Framer entrance animations; it ramps back to 60fps the instant
 * the canvas actually changes.
 *
 * It is coalesced + idempotent — safe to call many times per frame (the loop
 * renders at most once per frame). When no renderer is registered (tests), it is
 * a no-op.
 */

let requester: (() => void) | null = null;

/** MapRenderer registers its render-window opener here (null on teardown). */
export function setRenderRequester(fn: (() => void) | null): void {
  requester = fn;
}

/** Ask the renderer to draw the next few frames. Cheap, coalesced, spam-safe. */
export function requestRender(): void {
  requester?.();
}
