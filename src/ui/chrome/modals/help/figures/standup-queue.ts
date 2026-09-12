/** Serialize renderer startup, with a paint between jobs so queued work cannot occupy one frame. */
let tail: Promise<void> = Promise.resolve();

/** Run `job` after every previously queued standup, then let a frame paint before the next. A job
 *  that throws ends its own standup only; the chain carries on. */
export function queueStandup(job: () => Promise<void> | void): void {
  tail = tail
    .then(async () => {
      await job();
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { setTimeout(resolve, 0); });
        else resolve();
      });
    })
    .catch(() => undefined);
}
