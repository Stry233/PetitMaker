import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node); test reads the shipped map JSONs.
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import { generateTerrain, clearAllObjects, clearAllTerrain } from '../../../tools/generation/terrain-generator';
import { objectRect, getPlacedObjectSize } from '../../../state/object-geometry';
import { PLAZA_ID } from '../../../core/model/constants';
import { CellZone, TerrainType, type GridState, type MapTemplate, type EditorEvents, type GenerateConfig, type Command } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

// Shipped maps include fractional locked plazas and production zone boundaries absent from makeState.
function realState(file: string): GridState {
  const template = JSON.parse(readFileSync(`src/config/maps/${file}`, 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}

function generate(file: string, mode: 'earth' | 'water' | 'mixed', seed = 42) {
  const state = realState(file);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  // A mid-richness config, mode varied, maxElev 3.
  const config: GenerateConfig = {
    algorithm: 'designed', mode, corridorWidth: 1, maxElevation: 3, seed, region: null,
    richness: 0.5,
  };
  const start = exec.getUndoStackSize();
  clearAllObjects(state, (c: Command) => exec.execute(c));
  clearAllTerrain(state, (c: Command) => exec.execute(c));
  generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry());
  const postViol = exec.commitStrokeGroup(start).length;
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
  const objects = [...state.objects.values()].filter((o) => !o.locked).length;
  return { mtn, water, objects, postViol, onNonGrass, plazaSurvives: state.objects.has(PLAZA_ID) };
}

describe('generate on the real shipped maps (default config)', () => {
  for (const file of ['hexia.json', 'tafa.json']) {
    it(`${file}: every mode produces terrain + objects, rule-clean, plaza intact`, () => {
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
