/** The street stage's measured batches, shared by the public street tests and their internal reference readings. */
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { templateLandmarkObjects } from '../../../../../core/model/landmarks';
import { createGridState } from '../../../../../core/model/template';
import {
  TerrainType, type GridState, type MapTemplate, type PlacedObject,
} from '../../../../../core/model/types';
import type { CompositionPlan } from '../../../../../tools/generation/designer/composition/composition';
import { planDesign } from '../../../../../tools/generation/designer/pipeline';
import { cellTiers } from '../../../../../tools/generation/designer/planet';
import { evaluateMap } from '../../../../_support/design-eval';
import type { StreetPlan } from '../../../../../tools/generation/designer/streets/model';

export const HEXIA = MAP_TEMPLATES['hexia']!;
export const TAFA = MAP_TEMPLATES['tafa']!;
export const TEMPLATES = [HEXIA, TAFA];
/** Ten seeds, unrelated to each other, so a batch reading is not one arithmetic sequence. */
export const SEEDS = [7, 42, 777, 1024, 2026, 12345, 31337, 90210, 555, 8181];
/** The two ends of the richness axis: the flat garden town and the terraced planet. */
export const RICHNESS = [0.2, 1.0];


export interface Measured {
  composition: CompositionPlan;
  plan: StreetPlan;
  state: GridState;
  evaluation: ReturnType<typeof evaluateMap>;
}

const cache = new Map<string, Measured>();

/** A map carrying nothing but this stage's own output: the composition's plate tiers as terrain, the
 *  streets as road objects and the flights' ramps as ramp objects. That is exactly what the scorers
 *  read a finished map for, so the plan can be graded before a command exists. */
export function measure(seed: number, template: MapTemplate, richness: number): Measured {
  const key = `${template.id}/${seed}/${richness}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // The streets the pipeline plans, the movement line included: it is the map's first and widest
  // trunk, and the flights that carry it over the tier steps are the ones a walker climbs.
  const { composition, streets: plan } = planDesign({ seed, template, richness });
  const state: GridState = {
    template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) state.objects.set(plaza.id, plaza);
  const tier = tierField(template, composition);
  for (let y = 0; y < template.height; y++) {
    for (let x = 0; x < template.width; x++) {
      const t = tier[y * template.width + x]!;
      if (t > 0) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: t };
    }
  }
  plan.cells.forEach((c, i) => {
    const object: PlacedObject = {
      id: `road-${i}`, catalogId: c.material, position: { x: c.x, y: c.y }, rotation: 0,
      elevation: tier[c.y * template.width + c.x]!,
    };
    state.objects.set(object.id, object);
  });
  plan.ramps.forEach((r, i) => {
    const object: PlacedObject = {
      id: `ramp-${i}`, catalogId: r.catalogId, position: r.position, rotation: r.rotation,
      elevation: r.elevation,
    };
    state.objects.set(object.id, object);
  });
  const out: Measured = { composition, plan, state, evaluation: evaluateMap(state) };
  cache.set(key, out);
  return out;
}

/** The ground the plan was laid on: the composition's realized tiers, the same field the streets
 *  were planned against and the sculptor writes, not the plates' nominal tiers (a plate's rim slopes
 *  down to the shore, and a state built at the nominal tier would not be the map this plan is of). */
export function tierField(template: MapTemplate, composition: CompositionPlan): Int8Array {
  return cellTiers(template, composition);
}

/** Every (template, richness) batch, as one array a test can loop and report per group. */
export function batches(): { template: MapTemplate; richness: number; runs: Measured[] }[] {
  return TEMPLATES.flatMap((template) => RICHNESS.map((richness) => ({
    template, richness, runs: SEEDS.map((seed) => measure(seed, template, richness)),
  })));
}

export const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
