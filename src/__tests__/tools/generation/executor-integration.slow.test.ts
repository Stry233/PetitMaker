// Generation through the real CommandExecutor on a synthetic grid (`real-map-generate.slow.test.ts`
// covers the shipped maps): every terrain command passes the pre-command rules, V-MTN-02 and V-WTR-01
// included, and the post-stroke pass is clean. Object refusals are not counted: the pipeline seats
// objects by probing, so a refusal is how it learns a spot will not do.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation through the real executor; several seconds per case.
vi.setConfig({ testTimeout: 60_000 });
import { makeState, makeExecutor } from '../../_support/map-state';
import { generateTerrain } from '../../../tools/generation';
import { CommandType, TerrainType } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig, type PlanetKind } from '../../../tools/generation/recipe';

interface Outcome { placedLayers: number; terrainRejects: number; postViol: number; mtn: number; water: number; ground: number; }

function commit(mode: PlanetKind, seed: number, size = 48): Outcome {
  const state = makeState(size, size);
  const exec = makeExecutor(state);
  // No richness override, so the default is exercised. 48² is cramped for a designed planet, whose
  // places are 9 to 21 cells across.
  const config: GenerateConfig = defaultConfig('designed', { mode, maxElevation: 6, seed });
  let terrainRejects = 0;
  const start = exec.beginStroke();
  const res = generateTerrain({ state, execute: (cmd) => {
    const r = exec.execute(cmd);
    if (!r.success && (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.TrimCorners)) terrainRejects++;
    return r;
  }, reg: exec.getRegistry() }, config);
  const postViol = start.commit().length;
  let mtn = 0, water = 0, ground = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = state.cells[y]![x]!; if (c.zone !== 2 /* Grass */) continue;
    const t = c.terrain;
    if (!t) ground++;
    else if (t.type === TerrainType.Mountain) mtn++;
    else if (t.type === TerrainType.Water) water++;
    // A ground-islet edge cut (None with corners) is a rounded shoreline, so it counts as water.
    else if (t.type === TerrainType.None && t.corners?.some((k) => k !== 'square')) water++;
  }
  return { placedLayers: res.placed, terrainRejects, postViol, mtn, water, ground };
}

const SEEDS = [66, 1, 2, 7, 13, 42, 99, 100];

describe('generation through the real CommandExecutor', () => {
  it('commits cleanly for every planet kind × seed — no refused terrain, no post-stroke violations', () => {
    for (const mode of ['earth', 'water', 'mixed'] as const) {
      for (const seed of SEEDS) {
        const o = commit(mode, seed);
        expect(o.terrainRejects, `${mode} seed ${seed} refused terrain`).toBe(0);
        expect(o.postViol, `${mode} seed ${seed} post-stroke violations`).toBe(0);
        expect(o.placedLayers, `${mode} seed ${seed} produced no terrain`).toBeGreaterThan(0);
        expect(o.ground, `${mode} seed ${seed} left no buildable land`).toBeGreaterThan(0);
        expect(o.mtn, `${mode} seed ${seed} has no relief`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The kinds differ only in water scale (`pipeline.ts:WATER_SCALE`: earth 0, mixed 1, water 1.5).
   * The wet end is `>=` because on a grid this small the water budget saturates and water and mixed
   * often come out equal. Earth is dry because every water pass in `terrain-sculpt.ts` sits behind
   * `waterScale > 0`.
   */
  it('the planet kinds order by how much water they hold, and earth holds none', () => {
    for (const seed of SEEDS) {
      const earth = commit('earth', seed).water;
      const mixed = commit('mixed', seed).water;
      const water = commit('water', seed).water;
      expect(earth, `seed ${seed}: earth is not dry`).toBe(0);
      expect(mixed, `seed ${seed}: mixed holds no water`).toBeGreaterThan(0);
      expect(water, `seed ${seed}: the water kind holds less than mixed`).toBeGreaterThanOrEqual(mixed);
    }
  });
});
