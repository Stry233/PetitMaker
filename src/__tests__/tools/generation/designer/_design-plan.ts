// The DESIGN PLAN a (seed, template, richness) plans, through the real stages: composition, the
// movement line, the streets, then the districts that cut the places out of them. This is the chain
// `designer/pipeline.ts` itself runs, so a plan a test asks about is the plan a run would build.
import { ELEVATION_MAX } from '../../../../core/model/constants';
import type { MapTemplate } from '../../../../core/model/types';
import { planComposition } from '../../../../tools/generation/designer/composition/composition';
import { planDistricts } from '../../../../tools/generation/designer/places/districts';
import { planMovementLine } from '../../../../tools/generation/designer/composition/movement-line';
import { planStreets } from '../../../../tools/generation/designer/streets/streets';
import type { DesignPlan } from '../../../../tools/generation/designer/types';

export function planDesignFor(seed: number, template: MapTemplate, richness = 0.5): DesignPlan {
  const composition = planComposition(seed, template, richness, ELEVATION_MAX);
  const line = planMovementLine(seed, template, composition, richness);
  const streets = planStreets(seed, template, composition, richness, line);
  return planDistricts(seed, template, composition, streets, richness, undefined, line).design;
}
