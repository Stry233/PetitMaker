import type { Translate, I18nKey } from '../../i18n/keys';
import { isToolName } from './names';

/** The localized operation name shared by approvals and progress displays: `agent.verb_<tool>`
 *  for a shipped tool, the generic operation for any other name. */
export function toolVerbKey(name: string): I18nKey {
  return isToolName(name) ? `agent.verb_${name}` as const : 'agent.verb_operation';
}

/** Replaces operation identifiers only in displayed assistant text; provider history stays verbatim. */
export function displayAgentText(text: string, t: Translate): string {
  return text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (name) => t(toolVerbKey(name)));
}
