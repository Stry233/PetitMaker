/** What a held Smart Build press ticks on: the page's timers in the editor, or the stepped time of
 *  a host that plays its own timeline (a Help figure). */
export interface HoldClock {
  /** Calls `tick` every `ms` until the returned stop is called. */
  every(ms: number, tick: () => void): () => void;
}

/** The page's own timers. */
export const PAGE_CLOCK: HoldClock = {
  every: (ms, tick) => {
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  },
};
