/**
 * Watches one WebGL canvas for a context the engine takes and never gives back: a backgrounded
 * mobile tab loses its GPU process, and a canvas whose `webglcontextrestored` never arrives stays
 * blank until its renderer is rebuilt on a fresh context.
 */
export interface ContextLossOptions {
  /** Whether the canvas's context is lost right now (`gl.isContextLost()`). */
  isLost: () => boolean;
  /** Called once, when a loss outlives the grace or is found on return to the foreground. */
  onUnrecovered: () => void;
  /** How long a lost context may wait for its restore. */
  graceMs?: number;
}

export const CONTEXT_RESTORE_GRACE_MS = 2000;

/** Starts watching; the returned function stops. */
export function watchContextLoss(canvas: HTMLCanvasElement, opts: ContextLossOptions): () => void {
  const grace = opts.graceMs ?? CONTEXT_RESTORE_GRACE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reported = false;

  const report = (): void => {
    if (reported) return;
    reported = true;
    stop();
    opts.onUnrecovered();
  };
  const onLost = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (opts.isLost()) report(); }, grace);
  };
  const onRestored = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  // Background timers are throttled, so the return to the foreground reads the context directly.
  const onVisible = (): void => {
    if (document.visibilityState === 'visible' && opts.isLost()) report();
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', onVisible);

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    document.removeEventListener('visibilitychange', onVisible);
  }
  return stop;
}
