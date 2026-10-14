/**
 * One request in flight and the latest one waiting: hover previews ask far faster than a build
 * answers, so each new ask replaces the waiting one and starts once the one in flight settles.
 */
export class LatestRequest<Req> {
  private running = false;
  private waiting: Req | null = null;
  private generation = 0;

  /** `start` runs one request; `fresh()` stays true until `reset` makes its answer stale. */
  constructor(private readonly start: (req: Req, fresh: () => boolean) => Promise<void>) {}

  /** Make `req` the waiting request and start it if nothing is in flight. */
  ask(req: Req): void {
    this.waiting = req;
    this.pump();
  }

  /** Whether a newer request is waiting behind the one in flight. */
  hasWaiting(): boolean { return this.waiting !== null; }

  /** Drop the waiting request; the one in flight still answers. */
  drop(): void { this.waiting = null; }

  /** Drop the waiting request and make the answer in flight stale. */
  reset(): void {
    this.generation++;
    this.waiting = null;
  }

  private pump(): void {
    if (this.running || !this.waiting) return;
    const req = this.waiting, generation = this.generation;
    this.waiting = null; this.running = true;
    void this.start(req, () => generation === this.generation).finally(() => {
      this.running = false; this.pump();
    });
  }
}
