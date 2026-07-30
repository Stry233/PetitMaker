// src/tools/generation/waterfalls.ts
import { applyPlanToScratch } from './repair';
import type { RuleRegistry } from '../../rules/registry';
import type { MapTemplate, MacroCoord } from '../../core/model/types';
import type { TerrainPlan } from './types';

/**
 * Carve ONE legal elevated-water unit into `plan`: a run of `len` water cells at elevation E
 * (perpendicular to `flow`), flanked by mountain caps at exactly E, dropping onto a uniform
 * `landE` downstream row — the proven waterfall legality pattern (V-WTR-02 containment +
 * V-WTR-03 uniformity + cumulative-bottom-up support). Validates the WHOLE candidate against
 * the live registry on a scratch state; commits + returns true only when perfectly clean.
 *
 * `landE` defaults to the classic one-step cascade (E-1); a lower value carves a taller PLUNGE
 * (e.g. landE 0 drops a terrace river straight onto the valley floor). Downstream cells that are
 * already water at exactly landE are kept — that is the fall pouring INTO the lower river/lake,
 * the legal way to connect water bodies at different elevations. E is bounded at 3: the caps sit
 * at exactly E, and caps at >= 4 would trip the 3×3 base rule; falls above that height must chain
 * multiple units. Used by the terraced river course (zone-water-course).
 */
export function tryCarveWaterUnit(
  plan: TerrainPlan, grassMask: Uint8Array, at: MacroCoord, E: number, flow: readonly [number, number],
  len: number, template: MapTemplate, reg: RuleRegistry, landE: number = E - 1,
): boolean {
  const W = plan.width, H = plan.height;
  const grass = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && grassMask[y * W + x] === 1;
  const elev = (x: number, y: number): number => {
    if (!grass(x, y)) return -1;
    const i = y * W + x;
    return plan.water[i]! >= 0 ? plan.water[i]! : plan.tier[i]!;
  };
  const [fx, fy] = flow;
  if (Math.abs(fx) + Math.abs(fy) !== 1 || E < 1 || E > 3 || landE < 0 || landE >= E) return false;
  const px = fy, py = fx;
  const run: MacroCoord[] = [];
  for (let k = 0; k < len; k++) {
    const x = at.x + px * k, y = at.y + py * k;
    if (!grass(x, y) || elev(x + fx, y + fy) !== landE) return false;
    run.push({ x, y });
  }
  const capA: MacroCoord = { x: at.x - px, y: at.y - py };
  const last = run[run.length - 1]!;
  const capB: MacroCoord = { x: last.x + px, y: last.y + py };
  if (!grass(capA.x, capA.y) || !grass(capB.x, capB.y)) return false;

  const tier = plan.tier.slice(), water = plan.water.slice();
  const setMtn = (x: number, y: number, e: number): void => { const i = y * W + x; tier[i] = e as number; water[i] = -1; };
  const setWater = (x: number, y: number, e: number): void => { const i = y * W + x; tier[i] = 0; water[i] = e as number; };
  /** Normalize a downstream-row cell to landE: existing water at landE stays (the fall pours into
   *  it); dry cells become a landE mountain shelf, or clean ground when landE is 0. */
  const setLanding = (x: number, y: number): void => {
    if (!grass(x, y)) return;
    const i = y * W + x;
    if (water[i]! >= 0) return;                 // already water at landE (the elev() check above ensured it)
    if (landE <= 0) { tier[i] = 0; water[i] = -1; } else setMtn(x, y, landE);
  };
  setMtn(capA.x, capA.y, E); setMtn(capB.x, capB.y, E);
  for (const r of run) {
    setWater(r.x, r.y, E);
    setLanding(r.x + fx, r.y + fy);
  }
  for (const cap of [capA, capB]) setLanding(cap.x + fx, cap.y + fy);
  const candidate: TerrainPlan = { width: W, height: H, tier, water };
  if (reg.validatePostStroke(applyPlanToScratch(candidate, template)).length !== 0) return false;
  plan.tier.set(tier); plan.water.set(water);
  return true;
}
