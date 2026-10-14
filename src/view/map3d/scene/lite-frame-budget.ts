export type BudgetAction = 'increase' | 'reduce' | 'fallback' | null;

/** What the scene does after a frame: render larger or smaller (`scale` changed), switch to the lite
 *  materials, or give up on 3D. */
export type BudgetStep = 'increase' | 'reduce' | 'enter-lite' | 'fallback' | null;

/** A frame over either count is crowding the device whatever its timing. */
const RESOURCE_LIMIT = { calls: 100, triangles: 100_000 };
/** The render-scale multiplier's range and its steps up and down. */
const SCALE = { min: 0.5, max: 4, up: 1.5, down: 0.75 } as const;

/** Frame cadence guides quality; abandoning 3D requires sustained blocking render work. */
export class LiteFrameBudget {
  /** The render-scale multiplier the budget grants the presenter; it survives `reset`. */
  scale = 1;
  private windowStart = 0;
  private previous = 0;
  private samples = 0;
  private slow = 0;
  private blocking = 0;
  private resources = 0;
  private fast = 0;

  reset(): void {
    this.windowStart = 0;
    this.previous = 0;
    this.samples = 0;
    this.slow = 0;
    this.blocking = 0;
    this.resources = 0;
    this.fast = 0;
  }

  /**
   * One rendered frame against the budget, as the scene asks it: `lite` says the lite materials are
   * already in, so a reduction can only lower the scale; `canIncrease` is asked only where the scale
   * has room to grow.
   */
  step(
    now: number, renderMs: number,
    frame: { calls: number; triangles: number; lite: boolean; continuous: boolean; canIncrease: () => boolean },
  ): BudgetStep {
    const action = this.sample(now, renderMs, {
      overResources: frame.calls > RESOURCE_LIMIT.calls || frame.triangles > RESOURCE_LIMIT.triangles,
      canReduce: !frame.lite || this.scale > SCALE.min,
      continuous: frame.continuous,
      canIncrease: this.scale < SCALE.max && frame.canIncrease(),
    });
    switch (action) {
      case 'increase':
        this.scale = Math.min(SCALE.max, this.scale * SCALE.up);
        return 'increase';
      case 'reduce':
        if (!frame.lite) return 'enter-lite';
        this.scale = Math.max(SCALE.min, this.scale * SCALE.down);
        return 'reduce';
      default:
        return action;
    }
  }

  sample(
    now: number, renderMs: number,
    frame: { overResources: boolean; canReduce: boolean; continuous?: boolean; canIncrease?: boolean },
  ): BudgetAction {
    const { overResources, canReduce, continuous = true, canIncrease = false } = frame;
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
    // Host throttling can delay callbacks even when the scene renders quickly.
    if (renderMs > 50) this.blocking++;
    if (overResources && (renderMs > 1000 / 30 || interval > 1000 / 30)) this.resources++;
    if (now - this.windowStart < 1500 || this.samples < 12) return null;
    const slow = this.slow / this.samples >= 0.75;
    const blocked = this.blocking / this.samples >= 0.75;
    const crowded = this.resources / this.samples >= 0.75;
    const headroom = this.fast / this.samples >= 0.9;
    this.reset();
    if (canReduce && (slow || crowded)) return 'reduce';
    if (blocked) return 'fallback';
    return canIncrease && headroom ? 'increase' : null;
  }
}
