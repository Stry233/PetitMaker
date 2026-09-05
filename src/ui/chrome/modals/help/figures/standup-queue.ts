/*
 * standup-queue.ts — one demo figure stands up at a time.
 *
 * A scroll step can bring several figures into view at once, and a figure's standup (the renderer,
 * the world, the first frame) is its expensive beat — on a software rasterizer the GL context alone
 * costs most of a second. Standing them up inside one task freezes the scroll for their sum; the
 * queue gives each its own task with a painted frame after it, so the page stays responsive between
 * figures. A queued figure already shows its loading dots, so the wait has a face.
 */

let tail: Promise<void> = Promise.resolve();

/** Run `job` after every previously queued standup, then let a frame paint before the next. A job
 *  that throws ends its own standup only; the chain carries on. */
export function queueStandup(job: () => Promise<void> | void): void {
  tail = tail
    .then(async () => {
      await job();
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else resolve();
      });
    })
    .catch(() => undefined);
}
