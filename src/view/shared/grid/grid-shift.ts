/**
 * Where both views draw the cell grid's lines: at the offset of the grid the editor shows
 * (`core/game/profile.ts:GRIDS`), gliding from one grid's offset to another's on
 * `animConfig.gridShift`. Engine-free; each view samples it once per frame and draws the lines there.
 */
import type { MacroCoord } from '../../../core/base/coords';
import { GRIDS, PLACEMENT_GRID } from '../../../core/game/profile';
import type { GridId } from '../../../core/grid/grids';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { animConfig, easeOutCubic } from '../motion/anim-config';

export class GridShift {
  private from: Readonly<MacroCoord> = GRIDS[PLACEMENT_GRID].offset;
  private to: Readonly<MacroCoord> = this.from;
  private start = 0;
  private moving = false;
  /** The offset the lines stand at, in cells, as of the last `aim` or `step`. */
  offset: Readonly<MacroCoord> = this.from;

  /** The grid the lines settle on. */
  get target(): Readonly<MacroCoord> {
    return this.to;
  }

  /** Whether a glide is under way. */
  get gliding(): boolean {
    return this.moving;
  }

  /** Aims the lines at `grid`'s offset. With `glide` false (the grid was hidden) or under reduced
   *  motion they stand there at once; otherwise they glide from where they stand now. */
  aim(grid: GridId, glide: boolean, now = performance.now()): void {
    const to = GRIDS[grid].offset;
    if (to.x === this.to.x && to.y === this.to.y) return;
    this.to = to;
    if (!glide || isMotionReduced()) {
      this.from = this.offset = to;
      this.moving = false;
      return;
    }
    this.from = this.offset;
    this.start = now;
    this.moving = true;
  }

  /** Advances the glide to `now`; whether the lines moved. Reduced motion landing mid-glide ends it. */
  step(now = performance.now()): boolean {
    if (!this.moving) return false;
    const t = isMotionReduced() ? 1 : Math.min(1, Math.max(0, (now - this.start) / animConfig.gridShift.durationMs));
    const k = easeOutCubic(t);
    this.offset = { x: this.from.x + (this.to.x - this.from.x) * k, y: this.from.y + (this.to.y - this.from.y) * k };
    if (t >= 1) { this.offset = this.to; this.moving = false; }
    return true;
  }
}
