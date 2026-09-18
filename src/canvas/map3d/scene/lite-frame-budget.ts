export type BudgetAction = 'increase' | 'reduce' | 'fallback' | null;

/** Resource counts guide quality; only sustained slow rendering can abandon 3D. */
export class LiteFrameBudget {
  private windowStart = 0;
  private previous = 0;
  private samples = 0;
  private slow = 0;
  private resources = 0;
  private fast = 0;

  reset(): void {
    this.windowStart = 0;
    this.previous = 0;
    this.samples = 0;
    this.slow = 0;
    this.resources = 0;
    this.fast = 0;
  }

  sample(now: number, renderMs: number, overResources: boolean, canReduce: boolean, continuous = true, canIncrease = false): BudgetAction {
    const interval = this.previous ? now - this.previous : 0;
    // Demand-driven idle time and background-tab scheduling are not slow frames.
    if (!this.windowStart || !continuous) {
      this.reset();
      this.windowStart = now;
      this.previous = now;
      return null;
    }
    this.previous = now;
    this.samples++;
    if (renderMs <= 12 && interval <= 25) this.fast++;
    if (renderMs > 50 || interval > 50) this.slow++;
    if (overResources && (renderMs > 1000 / 30 || interval > 1000 / 30)) this.resources++;
    if (now - this.windowStart < 1500 || this.samples < 12) return null;
    const slow = this.slow / this.samples >= 0.75;
    const crowded = this.resources / this.samples >= 0.75;
    const headroom = this.fast / this.samples >= 0.9;
    this.reset();
    if (canReduce && (slow || crowded)) return 'reduce';
    if (slow) return 'fallback';
    return canIncrease && headroom ? 'increase' : null;
  }
}
