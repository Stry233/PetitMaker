// src/tools/generation/usability.ts
// Operates on the integer TerrainPlan + the grass mask (Uint8Array). Uses NEIGHBORS4
// expressed over the plan's own width/height (the plan is the same grid as the field).
import { NEIGHBORS4 } from '../../core/model/grid-model';
import { TUNING } from './tuning';
import type { TerrainPlan } from './types';

const flat = (p: TerrainPlan, grass: Uint8Array, i: number): boolean => grass[i] === 1 && p.tier[i] === 0 && p.water[i]! < 0;

/** Fraction of grass cells that are flat AND in the single largest connected flat region. */
export function connectedFlatFraction(p: TerrainPlan, grass: Uint8Array): number {
  const grassN = countGrass(grass);
  return grassN ? largestFlatRegion(p, grass).size / grassN : 0;
}

function countGrass(grass: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grass.length; i++) if (grass[i] === 1) n++;
  return n;
}

/** The cells of the single largest connected flat region. */
function largestFlatRegion(p: TerrainPlan, grass: Uint8Array): Set<number> {
  const seen = new Uint8Array(p.tier.length);
  let best: number[] = [];
  for (let s = 0; s < p.tier.length; s++) {
    if (seen[s] || !flat(p, grass, s)) continue;
    const comp: number[] = [], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!; comp.push(i); const x = i % p.width, y = (i / p.width) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= p.width || ny >= p.height) continue;
        const j = ny * p.width + nx; if (!seen[j] && flat(p, grass, j)) { seen[j] = 1; stack.push(j); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return new Set(best);
}

/** Peel mountains until the connected-flat fraction meets the target — MINIMALLY: grow the largest
 *  flat region outward by flattening the tier-1 ring around it, pass by pass, so designed terraces
 *  far from the floor survive (a global tier-1 wipe would level the whole designed island whenever
 *  lakes/rivers nudged the flat share under target). Clearing terrain only relaxes
 *  rule constraints, so the result stays rule-valid. Falls back to the global peel if ring growth
 *  stalls (e.g. the floor is fenced by tier-2 cliffs). */
export function enforceUsability(p: TerrainPlan, grass: Uint8Array, target: number): void {
  const grassN = countGrass(grass); // invariant across passes — grass never changes here
  for (let guard = 0; guard < TUNING.usabilityMaxPasses; guard++) {
    // ONE region BFS per pass, shared by the fraction check and the ring growth.
    const region = largestFlatRegion(p, grass);
    if ((grassN ? region.size / grassN : 0) >= target) break;
    let changed = false;
    for (const i of region) {
      const x = i % p.width, y = (i / p.width) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= p.width || ny >= p.height) continue;
        const j = ny * p.width + nx;
        if (grass[j] === 1 && p.tier[j] === 1 && p.water[j]! < 0) { p.tier[j] = 0; changed = true; }
      }
    }
    if (!changed) {
      for (let i = 0; i < p.tier.length; i++) {
        if (grass[i] === 1 && p.tier[i] === 1 && p.water[i]! < 0) { p.tier[i] = 0; changed = true; }
      }
    }
    if (!changed) { for (let i = 0; i < p.tier.length; i++) if (p.tier[i]! > 0) p.tier[i] = p.tier[i]! - 1; }
  }
}
