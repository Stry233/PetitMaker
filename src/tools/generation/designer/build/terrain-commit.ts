/**
 * THE SCULPT PUT ON THE MAP: the repair fixpoint, then the layer commands, then the crop.
 *
 * The one place a designed run writes terrain. Everything above it is a plan over a `TerrainPlan`
 * and everything below it is an object placed on the ground this produced, which is why the region
 * crop lives here too: cropping is what a scoped run does at commit time and nowhere else.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { RuleDispatcher } from '../../../../core/model/rule-dispatcher';
import type { Command, GridState, MacroCoord, ValidationResult } from '../../../../core/model/types';
import { planToCommands } from '../../core/commit';
import { repairPlan } from '../../core/repair';
import type { TerrainPlan } from '../../core/types';
import type { TerrainSculpt } from '../terrain/terrain-sculpt';

/** The part of a run's context a terrain commit needs: the map, the command door, the rules. */
export interface CommitContext {
  state: GridState;
  execute: (c: Command) => ValidationResult;
  reg: RuleDispatcher;
}

/**
 * Commit the sculpt: the decrease-only repair fixpoint first, then the cumulative bottom-up layers
 * `planToCommands` emits.
 *
 * The repair pass is a backstop rather than the mechanism — the sculpt draws only shapes the rules
 * already accept — but it is the same fixpoint every generated map goes through, and running it
 * keeps a hand-edited tunable from turning into an illegal map. What it lowers is written back into
 * the sculpt, so a caller reads the terrain the map actually got.
 */
export function commitTerrain(
  ctx: CommitContext, sculpt: TerrainSculpt, region: MacroCoord[] | null,
): { commands: number; refused: number } {
  const repaired = repairPlan(sculpt.terrain, ctx.state.template, ctx.reg);
  if (region) keepWaterWhole(repaired, region, ctx.state.template.width, ctx.state.template.height);
  sculpt.terrain.tier.set(repaired.tier);
  sculpt.terrain.water.set(repaired.water);
  let commands = 0, refused = 0;
  // The plan is the WHOLE island's and the region crops the commands, which is where a scoped run
  // can legitimately be refused: a terrace whose supporting neighbours fell outside the crop has no
  // base to stand on. An unscoped run still expects zero, and the probes hold it to that.
  for (const cmd of planToCommands(repaired, region)) {
    commands++;
    if (!ctx.execute(cmd).success) refused++;
  }
  return { commands, refused };
}

/**
 * A BED IS CUT WHOLE OR NOT AT ALL, when a region crops the commit.
 *
 * Cropping mountain is safe in the way that matters: it can only remove mass, and a layer command
 * refused for want of support simply leaves the cell a tier lower, which is legal. Cropping WATER is
 * not. An elevated body is legal because the ring around it stands at its own tier — that is the
 * whole of the argument the sculpt cuts it by (V-WTR-02 asks for caps only where a cell faces
 * something lower) — and a crop that keeps the water while dropping the rim outside the region
 * leaves a face nothing caps. Measured: a rect region over the town reverted the entire run.
 *
 * So an elevated bed whose own 3x3 does not fit inside the region is not cut, and the TERRACE IT WAS
 * CUT FROM stands there instead. Ground-level water faces nothing lower and is cropped freely.
 */
function keepWaterWhole(plan: TerrainPlan, region: MacroCoord[], W: number, H: number): void {
  const inside = new Uint8Array(W * H);
  for (const c of region) {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) inside[flatIndex(c.x, c.y, W)] = 1;
  }
  const whole = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !inside[flatIndex(nx, ny, W)]) return false;
      }
    }
    return true;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      const level = plan.water[i]!;
      if (level <= 0 || whole(x, y)) continue;
      plan.tier[i] = level;
      plan.water[i] = -1;
    }
  }
}
