/**
 * Every refusal message a rule can raise, with the category key a toast leads with. A rule's
 * `fail` accepts only these keys, and `i18n/terms/rule-copy.ts` reads the category from here. A refusal a
 * tool raises itself has its category in `i18n/terms/rule-copy.ts:TOOL_REFUSALS`.
 */
import type { I18nKey } from '../i18n/keys';

export const RULE_MESSAGES = {
  'error.zone_restricted': 'rule.category.placement',
  'error.landmark_coast': 'rule.category.placement',
  'error.across_zone_boundary': 'rule.category.placement',
  'error.placement_not_flat': 'rule.category.placement',
  'error.placement_off_grid': 'rule.category.placement',
  'error.door_near_drop': 'rule.category.placement',
  'error.door_near_rise': 'rule.category.placement',
  'error.too_close_same_kind': 'rule.category.placement',
  'error.house_too_close': 'rule.category.placement',
  'error.house_tree_too_close': 'rule.category.placement',
  'error.object_overlap': 'rule.category.placement',
  'error.object_on_road': 'rule.category.placement',
  'error.max_count': 'rule.category.placement',
  'error.ground_under_block': 'rule.category.terrain',
  'error.ground_under_object': 'rule.category.terrain',
  'error.object_blocks_terrain': 'rule.category.terrain',
  'error.elevation_limit': 'rule.category.elevation',
  'error.floating_block': 'rule.category.floating',
  'error.need_base_support': 'rule.category.base',
  'error.waterfall_adjacent_not_uniform': 'rule.category.waterfall',
  'error.road_needs_terrain': 'rule.category.road',
  'error.bridge_invalid': 'rule.category.bridge',
  'error.ramp_wrong_height': 'rule.category.ramp',
  'error.chunk_full': 'rule.category.chunk_load',
  'error.layer_locked': 'rule.category.layer',
  'error.locked_immutable': 'rule.category.locked',
  'error.water_uncapped': 'rule.category.water',
} as const satisfies Readonly<Partial<Record<I18nKey & `error.${string}`, I18nKey & `rule.category.${string}`>>>;

export type RuleMessageKey = keyof typeof RULE_MESSAGES;

