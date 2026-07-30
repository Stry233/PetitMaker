// Integration test through the REAL CommandExecutor — the path App uses. This is the
// invariant the unit-level matrix could not see: generated terrain must actually COMMIT
// (every PaintTerrain passes the pre-command rules, incl. no-floating V-MTN-02/V-WTR-01)
// and the post-stroke pass must be clean. It also pins per-mode semantics.
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { TerrainType, type EditorEvents, type GenerateConfig } from '../../../core/model/types';

interface Outcome { placedLayers: number; rejects: number; postViol: number; mtn: number; water: number; ground: number; grass: number; waterfalls: number; }

function commit(mode: 'earth' | 'water' | 'mixed', seed: number, size = 48): Outcome {
  const state = makeState(size, size);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  // No relief override — exercise the DEFAULT (toGenConfig defaults relief to 0.8), i.e. the
  // out-of-box experience. 48² is closer to the real map; smaller grids can flatten a few seeds.
  const config: GenerateConfig = { algorithm: 'random', mode, corridorWidth: 1, maxElevation: 6, seed, region: null };
  let rejects = 0;
  const start = exec.getUndoStackSize();
  const res = generateTerrain(config, state, (cmd) => { const r = exec.execute(cmd); if (!r.success) rejects++; return r; });
  const postViol = exec.commitStrokeGroup(start).length;
  let mtn = 0, water = 0, ground = 0, grass = 0, waterfalls = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = state.cells[y]![x]!; if (c.zone !== 2 /* Grass */) continue; grass++;
    const t = c.terrain;
    if (!t) ground++;
    else if (t.type === TerrainType.Mountain) mtn++;
    else if (t.type === TerrainType.Water) { water++; if (t.elevation > 0) waterfalls++; }
    // A ground-island edge-cut (None + corners) is the lake's rounded SHORELINE — it exists only where
    // ground pokes into water (cutGroundIslands). It counts toward the water feature's footprint here:
    // Counting it keeps the water-dominance metric measuring the whole lake extent, whichever way the
    // shoreline notch is cut (a patchOnly-water fillet there would be illegal, see auto-edge-cut).
    else if (t.type === TerrainType.None && t.corners?.some((k) => k !== 'square')) water++;
  }
  return { placedLayers: res.placed, rejects, postViol, mtn, water, ground, grass, waterfalls };
}

const SEEDS = [66, 1, 2, 7, 13, 42, 99, 100];

describe('generation through the real CommandExecutor', () => {
  it('commits cleanly for every mode × seed — no rejected commands, no post-stroke violations', () => {
    for (const mode of ['earth', 'water', 'mixed'] as const) {
      for (const seed of SEEDS) {
        const o = commit(mode, seed);
        expect(o.rejects, `${mode} seed ${seed} rejected commands`).toBe(0);
        expect(o.postViol, `${mode} seed ${seed} post-stroke violations`).toBe(0);
        expect(o.placedLayers, `${mode} seed ${seed} produced no terrain`).toBeGreaterThan(0);
      }
    }
  });

  it('earth mode: mountains, never water', () => {
    for (const seed of SEEDS) {
      const o = commit('earth', seed);
      expect(o.water, `earth seed ${seed} has water`).toBe(0);
      expect(o.mtn, `earth seed ${seed} has no mountains`).toBeGreaterThan(0);
    }
  });

  it('water mode: water-dominant (lots of water) with buildable land', () => {
    for (const seed of SEEDS) {
      const o = commit('water', seed);
      expect(o.water, `water seed ${seed} not watery enough`).toBeGreaterThan(o.grass * 0.2);
      expect(o.ground, `water seed ${seed} has no buildable land`).toBeGreaterThan(0);
    }
  });

  it('mixed mode: has water AND buildable land, less water than water mode', () => {
    for (const seed of SEEDS) {
      const mixed = commit('mixed', seed);
      const water = commit('water', seed);
      expect(mixed.water, `mixed seed ${seed} has no water`).toBeGreaterThan(0);
      expect(mixed.ground, `mixed seed ${seed} has no land`).toBeGreaterThan(0);
      expect(mixed.water, `mixed seed ${seed} not less watery than water mode`).toBeLessThan(water.water);
    }
  });

  it('mixed mode produces legal waterfalls; water mode (no mountains) produces none', () => {
    // Waterfalls need mountains for caps — only mixed has them. Assert the SUM across seeds.
    const mixedFalls = SEEDS.reduce((s, seed) => s + commit('mixed', seed).waterfalls, 0);
    expect(mixedFalls, 'mixed produced no waterfalls across all seeds').toBeGreaterThan(0);
    const waterFalls = SEEDS.reduce((s, seed) => s + commit('water', seed).waterfalls, 0);
    expect(waterFalls, 'water mode should have no waterfalls (flat islands, no mountains)').toBe(0);
  });
});
