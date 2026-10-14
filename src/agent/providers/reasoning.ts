/** Capability-driven thinking controls translated into the provider's request dialect. */
import { QUIRKS, type ProviderId, type ThinkingWire } from './defaults';
import type { ModelCapabilities, ThinkingChoice } from '../core/adapter';

export function thinkingChoices(caps: ModelCapabilities | undefined, provider: ProviderId): ThinkingChoice[] {
  if (!caps || caps.reasoning === false) return [];
  if (caps.efforts?.length) return caps.efforts.map((effort) => ({ effort }));
  if (!caps.budget || !QUIRKS[provider].thinkingBudgets) return [];
  const min = caps.budget.min, max = Math.min(caps.budget.max ?? 16384, (caps.maxOutput ?? 32768) - 1);
  return [...new Set([min, Math.max(min, 4096), Math.max(min, 16384)].map((n) => Math.min(n, max)))].filter((n) => n >= min).map((budget) => ({ budget }));
}
/** The lightest effort the model offers, for a short side request such as a reply draft. */
export function lightestEffort(caps: ModelCapabilities | undefined): string | undefined {
  return ['none', 'minimal', 'low'].find((effort) => caps?.efforts?.includes(effort));
}
export const thinkingChoiceKey = (choice: ThinkingChoice): string => choice.effort ?? `budget:${choice.budget}`;

export function reasoningBody(wire: ThinkingWire, choice: ThinkingChoice | undefined, caps?: ModelCapabilities): Record<string, unknown> {
  if (wire === 'anthropic') return {
    ...(choice?.effort ? { output_config: { effort: choice.effort } } : {}),
    ...(choice?.budget ? { thinking: { type: 'enabled', budget_tokens: choice.budget } } : {}),
  };
  if (wire === 'openrouter') return choice ? { reasoning: { ...(choice.effort ? { effort: choice.effort } : { max_tokens: choice.budget }) } } : {};
  if (wire === 'gemini') return {
    ...(choice?.effort ? { reasoning_effort: choice.effort } : {}),
    ...(caps?.reasoning ? {
      extra_body: { google: { thinking_config: { include_thoughts: true, ...(choice?.budget ? { thinking_budget: choice.budget } : {}) } } },
    } : {}),
  };
  if (!choice) return {};
  if (choice.effort === 'none' && wire === 'toggle') return { thinking: { type: 'disabled' } };
  if (choice.effort === 'none' && wire === 'qwen') return { enable_thinking: false };
  if (wire === 'qwen') return { enable_thinking: choice.effort !== 'none', ...(choice.budget ? { thinking_budget: choice.budget } : { reasoning_effort: choice.effort }) };
  return {
    ...(choice.effort ? { reasoning_effort: choice.effort } : {}),
    ...(wire === 'toggle' ? { thinking: { type: choice.effort === 'none' ? 'disabled' : 'enabled' } } : {}),
  };
}
