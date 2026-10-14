/**
 * Runs `callback` once the next frame has painted: a frame callback runs before that frame paints,
 * and a timer set inside it runs after. Without `requestAnimationFrame` (a worker, jsdom without the
 * polyfill) it runs on a zero timer. Returns a cancel that stops whichever step is pending.
 */
export function onAfterPaint(callback: () => void): () => void {
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(() => { frame = undefined; timer = setTimeout(callback, 0); });
  else timer = setTimeout(callback, 0);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** Resolves once the next frame has painted, so work queued after it lets a busy state show first. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => { onAfterPaint(resolve); });
}

/** `fn` collapsed to one call per animation frame: every `run` within a frame becomes a single call
 *  at that frame. `cancel` drops a pending call. */
export function coalesceToFrame(fn: () => void): { run: () => void; cancel: () => void } {
  let frame = 0;
  return {
    run: () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fn(); }); },
    cancel: () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
