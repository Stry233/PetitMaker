// The design plan a (seed, template, richness) plans, through `planDesign`, the chain
// `designer/pipeline.ts` itself runs, so a plan a test asks about is the plan a run would build.
import type { MapTemplate } from '../../../../core/model/types';
import { planDesign } from '../../../../tools/generation/designer/pipeline';
import type { DesignPlan } from '../../../../tools/generation/designer/types';
import { ELEVATION_MAX } from '../../../../core/game/profile';

export function planDesignFor(seed: number, template: MapTemplate, richness = 0.5): DesignPlan {
  return planDesign({ seed, template, richness, maxElevation: ELEVATION_MAX }).plan;
}
