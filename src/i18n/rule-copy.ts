/**
 * Rule refusals in two parts: the reason (the rule's own `error.*` message) and the category a toast
 * leads with, which `rules/messages.ts` assigns. Only a toast, and the assistant's model-facing
 * feedback, joins them as "Category: reason" through `rule.toast`; every other surface shows the reason alone.
 */
import type { ValidationError } from '../core/model/types';
import type { Translate, I18nKey, TextKey } from './keys';
import { quantityParams } from './context';
import { RULE_MESSAGES } from '../rules/messages';

/** Refusals a tool raises itself rather than through a rule, with the category a toast leads with:
 *  a group turn a spanning member cannot make, and water laid off the one layer a stroke allows. */
const TOOL_REFUSALS = {
  'error.span_no_group_rotate': 'rule.category.rotation',
  'error.water_only_layer': 'rule.category.water',
} as const satisfies Readonly<Partial<Record<I18nKey & `error.${string}`, I18nKey & `rule.category.${string}`>>>;

const CATEGORY: Readonly<Partial<Record<TextKey, I18nKey>>> = { ...RULE_MESSAGES, ...TOOL_REFUSALS };

/**
 * The key a refusal carries. Core holds a rule's message as a plain string; every rule raises one of
 * `RULE_MESSAGES` through its `fail`, and the other refusals name interface keys.
 */
export function refusalKey(message: string): TextKey {
  return message as TextKey;
}

/** A refusal's reason alone. Its params are limits and counts, so they read in the translator's own
 *  number format. */
export function ruleReason(t: Translate, key: TextKey, params?: Record<string, string | number>): string {
  return t(key, t.locale ? quantityParams(t.locale, params) : params);
}

/** The refusal `key` as a toast says it: its category, then its reason. A message with no category
 *  is said as it is. */
export function ruleToast(t: Translate, key: TextKey, params?: Record<string, string | number>): string {
  const reason = ruleReason(t, key, params);
  const category = CATEGORY[key];
  return category ? t('rule.toast', { category: t(category), reason }) : reason;
}

/** A refusal as a toast says it, with the rule's own parameters filled in. */
export function violationToast(t: Translate, violation: Pick<ValidationError, 'message' | 'messageParams'>): string {
  return ruleToast(t, refusalKey(violation.message), violation.messageParams);
}
