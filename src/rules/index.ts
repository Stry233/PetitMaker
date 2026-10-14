import type { AnyRule } from '../core/model/types';
import { RuleRegistry, type RuleSetName } from './registry';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import { zoneRestrictionRule } from './zone-restriction';
import { groundLockRule } from './ground-lock';
import { planetGroundRule } from './planet-ground';
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
 * Every rule in canonical registration order.
 *
 * Pre-command order: lock → elevation → floating → block → trait placement → ground lock → zone → overlap → max-count → chunk
 * Post-stroke order: base-support → water-containment → waterfall-adjacent-uniformity → object-on-coating
 *
 * Pre-command order sets the order of a refusal's errors, so locked-layer errors come first. Every
 * rule judges the command as it lands: the registry resolves it (a bridge or ramp snapped onto its
 * span) before any rule runs.
 */
const ALL_RULES = [
  layerLockRule,
  lockedObjectRule,
  elevationRangeRule,
  mountainFloatingRule,
  waterFloatingRule,
  objectBlocksTerrainRule,
  traitPlacementRule,
  groundLockRule,
  zoneRestrictionRule,
  placementOverlapRule,
  placementMaxCountRule,
  chunkLoadRule,
  baseSupportRule,
  waterContainmentRule,
  waterfallAdjacentUniformityRule,
  objectOnCoatingRule,
] satisfies readonly AnyRule[];

/** The id of every rule a registry may hold; a refusal's `ruleId` is one of these unless its
 *  maker names its own. */
export type RuleId = (typeof ALL_RULES)[number]['id'] | typeof planetGroundRule.id;

/** The registry for a named rule set, built the same on any thread. `default` holds every rule in
 *  that order; `planet`, the session's, drops V-GROUND-LOCK so layer 0 is editable and holds the
 *  ground under objects with V-PLANET-01, registered last. */
export function createRuleRegistry(set: RuleSetName): RuleRegistry {
  const registry = new RuleRegistry(set);
  for (const rule of ALL_RULES) if (set === 'default' || rule !== groundLockRule) registry.register(rule);
  if (set === 'planet') registry.register(planetGroundRule);
  return registry;
}

/** A registry holding every rule in that order. */
export function createDefaultRegistry(): RuleRegistry {
  return createRuleRegistry('default');
}

/** The planet session's rules: layer 0 is editable, and the ground under objects is held. */
export function createPlanetRegistry(): RuleRegistry {
  return createRuleRegistry('planet');
}

/** The named set `rules` was built as, or null for one no other thread can rebuild. */
export function ruleSetOf(rules: RuleDispatcher): RuleSetName | null {
  return rules instanceof RuleRegistry ? rules.ruleSet : null;
}

export { RuleRegistry, type RuleSetName } from './registry';
