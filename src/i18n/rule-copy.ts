/**
 * Rule refusals in two parts: the reason (the rule's own `error.*` message) and the category a toast
 * leads with. Only a toast, and the assistant's model-facing feedback, joins them as
 * "Category: reason" through `rule.toast`; every other surface shows the reason alone.
 */
import type { Translate } from '../core/model/types';

/** The category each rule message belongs to. */
const RULE_CATEGORY: Readonly<Record<string, string>> = {
  'error.zone_restricted': 'rule.category.placement',
  'error.placement_not_flat': 'rule.category.placement',
  'error.placement_off_grid': 'rule.category.placement',
  'error.too_close_same_kind': 'rule.category.placement',
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
  'error.span_no_group_rotate': 'rule.category.rotation',
  'error.water_uncapped': 'rule.category.water',
  'error.water_only_layer': 'rule.category.water',
};

/** The refusal `key` as a toast says it: its category, then its reason. A message with no category
 *  is said as it is. */
export function ruleToast(t: Translate, key: string, params?: Record<string, string | number>): string {
  const reason = t(key, params);
  const category = RULE_CATEGORY[key];
  return category ? t('rule.toast', { category: t(category), reason }) : reason;
}
