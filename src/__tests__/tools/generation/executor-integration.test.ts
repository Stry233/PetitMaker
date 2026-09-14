// Integration test through the REAL CommandExecutor — the path the shelf uses. This is the
// invariant a unit-level plan check cannot see: generated TERRAIN must actually COMMIT (every
// PaintTerrain passes the pre-command rules, no-floating V-MTN-02/V-WTR-01 included) and the
// post-stroke pass must be clean, on a synthetic grid as well as on the shipped maps
// (`real-map-generate.test.ts` is the same question asked of those).
//
// OBJECT placements are a different matter and are counted, not required: the pipeline seats every
// object by PROBING through `tryPlace`, so a refusal is how it finds out that a spot will not do.
// The refusals a run collected come back as `GenerateResult.skipped`, and the designer's own probes
// are where a run is held to zero of them on ground where every placement should be legal.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation through the real executor; several seconds per case.
vi.setConfig({ testTimeout: 60_000 });
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { CommandType, TerrainType, type EditorEvents, type GenerateConfig } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

interface Outcome { placedLayers: number; terrainRejects: number; postViol: number; mtn: number; water: number; ground: number; }

function commit(mode: 'earth' | 'water' | 'mixed', seed: number, size = 48): Outcome {
  const state = makeState(size, size);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  // No richness override — exercise the shelf's own default. 48² is small for a designed island
  // (its places are 9 to 21 cells across), which is the point: the terrain must commit even where
  // the composition is cramped.
  const config: GenerateConfig = { algorithm: 'designed', mode, corridorWidth: 1, maxElevation: 6, seed, region: null };
  let terrainRejects = 0;
  const start = exec.getUndoStackSize();
  const res = generateTerrain(config, state, (cmd) => {
    const r = exec.execute(cmd);
    if (!r.success && (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.TrimCorners)) terrainRejects++;
    return r;
  }, exec.getRegistry());
  const postViol = exec.commitStrokeGroup(start).length;
  let mtn = 0, water = 0, ground = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = state.cells[y]![x]!; if (c.zone !== 2 /* Grass */) continue;
    const t = c.terrain;
    if (!t) ground++;
    else if (t.type === TerrainType.Mountain) mtn++;
    else if (t.type === TerrainType.Water) water++;
    // A ground-island edge-cut (None + corners) is a rounded SHORELINE: it exists only where ground
    // pokes into water. It counts as water here, so a body reads at its whole extent whichever way
    // its notches were cut.
    else if (t.type === TerrainType.None && t.corners?.some((k) => k !== 'square')) water++;
  }
  return { placedLayers: res.placed, terrainRejects, postViol, mtn, water, ground };
}

const SEEDS = [66, 1, 2, 7, 13, 42, 99, 100];

describe('generation through the real CommandExecutor', () => {
  it('commits cleanly for every island kind × seed — no refused terrain, no post-stroke violations', () => {
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
   * THE THREE KINDS ARE A WATER SCALE and nothing else (`pipeline.ts:WATER_SCALE`: earth 0, mixed 1,
   * water 1.5), so that ordering is the whole of what they promise. It is claimed per seed rather
   * than as a batch mean, and as `<=` on the wet end because the budget saturates: on a grid this
   * small there is often no more room for water, so water and mixed come out equal.
   *
   * EARTH IS DRY, and this is the surface that can still ask for it: the shelf offers ONE island kind
   * and `generate-shelf.ts:modeFor` answers `mixed` for every one, so a kind other than mixed reaches
   * the engine only from a recipe saved before the kinds collapsed. It is dry BY GATE and not by luck — every
   * water pass, the landmark figure included, sits behind `waterScale > 0` in `terrain-sculpt.ts`.
   */
  it('the island kinds order by how much water they hold, and earth holds none', () => {
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
