import type { AnyRule } from '../core/model/types';
import { RuleRegistry } from './registry';
import { zoneRestrictionRule } from './zone-restriction';
import { layerLockRule } from './layer-lock';
import { lockedObjectRule } from './locked-object';
import { elevationRangeRule } from './elevation-range';
import { mountainFloatingRule, waterFloatingRule } from './floating-block';
import { traitPlacementRule } from './placement';
import { placementOverlapRule } from './placement-overlap';
import { placementMaxCountRule } from './placement-max-count';
import { objectBlocksTerrainRule } from './object-blocks-terrain';
import { chunkLoadRule } from './chunk-load';
import { baseSupportRule } from './base-support';
import { waterContainmentRule } from './water-containment';
import { waterfallAdjacentUniformityRule } from './waterfall-uniformity';
import { objectOnCoatingRule } from './object-on-coating';

/**
 * Creates a RuleRegistry with all game rules in canonical order.
 *
 * Pre-command order: lock → zone → elevation → floating → placement → chunk
 * Post-stroke order: base-support → water-containment → waterfall-adjacent-uniformity → object-on-coating
 *
 * Order matters for pre-command rules: lock check runs first so locked-layer
 * errors take priority.
 *
 * traitPlacementRule runs before zoneRestrictionRule AND placementOverlapRule because the
 * waterSpan/heightDrop traits intentionally SNAP the object's position/rotation/spanLength
 * during validation (auto-orienting bridges and ramps). Both zone and overlap must check the
 * SNAPPED footprint, not the raw click position — else a ramp/bridge can snap onto a non-grass
 * zone (beach/boundary) and be accepted (the generator once placed an illegal ramp on the beach).
 */
/** Every rule in canonical registration order (see the order note above).
 *  zoneRestrictionRule sits AFTER traitPlacementRule so it validates the snapped
 *  heightDrop/waterSpan footprint. */
const ALL_RULES: AnyRule[] = [
  layerLockRule,
  lockedObjectRule,
  elevationRangeRule,
  mountainFloatingRule,
  waterFloatingRule,
  objectBlocksTerrainRule,
  traitPlacementRule,
  zoneRestrictionRule,
  placementOverlapRule,
  placementMaxCountRule,
  chunkLoadRule,
  baseSupportRule,
  waterContainmentRule,
  waterfallAdjacentUniformityRule,
  objectOnCoatingRule,
];

export function createDefaultRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  for (const rule of ALL_RULES) registry.register(rule);
  return registry;
}

/** id → agent-facing explanation, derived from each rule's own `agentHint` (the
 *  single source of truth). The system prompt lists these and the agent tool
 *  layer appends them to rejection feedback, so a policy's wording lives in ONE
 *  place: its rule file. */
export const RULE_HINTS: Record<string, string> = Object.fromEntries(
  ALL_RULES.filter((r) => r.agentHint).map((r) => [r.id, r.agentHint!]),
);

export { RuleRegistry } from './registry';
