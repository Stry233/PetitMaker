import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { templateLandmarkObjects } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { clearAllObjects, clearAllTerrain } from '../../../tools/generation';
import { objectRect, getPlacedObjectSize } from '../../../state/object-geometry';
import { TerrainType, type GridState, type MapTemplate, type Command } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig, type PlanetKind } from '../../../tools/generation/recipe';
import { CellZone } from '../../../core/game/zones';
import { getMapStats } from '../../../state/map-stats';
import { CHUNK_LOAD_LIMIT } from '../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { makeExecutor } from '../../_support/map-state';
import { generateWith } from '../../_support/generation';

// Shipped maps include fractional locked plazas and production zone boundaries absent from makeState.
function realState(file: string): GridState {
  const template = JSON.parse(readFileSync(`src/config/maps/${file}`, 'utf8')) as MapTemplate;
  const cells = createGridState(template).cells;
  const objects = new Map();
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

function generate(file: string, mode: PlanetKind, seed = 42) {
  const state = realState(file);
  const exec = makeExecutor(state);
  // A mid-richness config, mode varied, maxElev 3.
  const config: GenerateConfig = defaultConfig('designed', { mode, maxElevation: 3, seed, richness: 0.5 });
  const start = exec.beginStroke();
  clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
  clearAllTerrain({ state, execute: (c: Command) => exec.execute(c) });
  generateWith(state, exec, config);
  const postViol = start.commit().length;
  let mtn = 0, water = 0;
  for (let y = 0; y < state.template.height; y++) for (let x = 0; x < state.template.width; x++) {
    const t = state.cells[y]![x]!.terrain;
    if (t?.type === TerrainType.Mountain) mtn++; else if (t?.type === TerrainType.Water) water++;
  }
  // Snapped ramps and bridges remain subject to the final grass-zone placement rule.
  let onNonGrass = 0;
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const r = objectRect(o), sz = getPlacedObjectSize(o);
    for (let yy = Math.floor(r.y); yy < Math.ceil(r.y + sz.h); yy++)
      for (let xx = Math.floor(r.x); xx < Math.ceil(r.x + sz.w); xx++)
        if (state.cells[yy]?.[xx]?.zone !== CellZone.Grass) onNonGrass++;
  }
  for (const [key, chunk] of getMapStats(state).chunks) {
    expect(chunk.load, `${file} seed ${seed} region ${key}`).toBeLessThanOrEqual(CHUNK_LOAD_LIMIT);
  }
  const objects = [...state.objects.values()].filter((o) => !o.locked).length;
  return { mtn, water, objects, postViol, onNonGrass, plazaSurvives: state.objects.has(ANCHOR_LANDMARK.id) };
}

describe('generate on the real shipped maps (default config)', () => {
  for (const file of ['hexia.json', 'tafa.json']) {
    it(`${file}: every mode produces terrain + objects, rule-clean, plaza intact`, { timeout: 20_000 }, () => {
      const earth = generate(file, 'earth');
      expect(earth.postViol, 'earth rule-clean').toBe(0);
      expect(earth.mtn, 'earth has mountains').toBeGreaterThan(0);
      expect(earth.objects, 'earth populated').toBeGreaterThan(0);
      expect(earth.onNonGrass, 'earth: no object on a non-grass cell').toBe(0);
      expect(earth.plazaSurvives).toBe(true);

      const water = generate(file, 'water');
      expect(water.postViol, 'water rule-clean').toBe(0);
      expect(water.water, 'water has water').toBeGreaterThan(0);
      expect(water.objects, 'water populated').toBeGreaterThan(0);
      expect(water.onNonGrass, 'water: no object on a non-grass cell').toBe(0);

      const mixed = generate(file, 'mixed');
      expect(mixed.postViol, 'mixed rule-clean').toBe(0);
      expect(mixed.mtn, 'mixed has mountains').toBeGreaterThan(0);
      expect(mixed.water, 'mixed has water').toBeGreaterThan(0);
      expect(mixed.objects, 'mixed populated').toBeGreaterThan(0);
      expect(mixed.onNonGrass, 'mixed: no object on a non-grass cell').toBe(0);
    });
  }
  it('seed 53689 earth places no ramp or bridge on a non-grass cell', () => {
    for (const file of ['hexia.json', 'tafa.json']) {
      const r = generate(file, 'earth', 53689);
      expect(r.onNonGrass, `${file} seed 53689: no object on non-grass`).toBe(0);
      expect(r.postViol, `${file} seed 53689 rule-clean`).toBe(0);
    }
  });
});
