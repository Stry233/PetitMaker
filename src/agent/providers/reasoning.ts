/** Capability-driven thinking controls translated into the provider's request dialect. */
import type { ProviderId } from './defaults';
import type { ModelCapabilities } from './model-catalog';

export interface ThinkingChoice { effort?: string; budget?: number }
export function thinkingChoices(caps: ModelCapabilities | undefined, provider: ProviderId): ThinkingChoice[] {
  if (!caps || caps.reasoning === false) return [];
  if (caps.efforts?.length) return caps.efforts.map((effort) => ({ effort }));
  if (!caps.budget || !['claude', 'qwen', 'gemini', 'openrouter'].includes(provider)) return [];
  const min = caps.budget.min, max = Math.min(caps.budget.max ?? 16384, (caps.maxOutput ?? 32768) - 1);
  return [...new Set([min, Math.max(min, 4096), Math.max(min, 16384)].map((n) => Math.min(n, max)))].filter((n) => n >= min).map((budget) => ({ budget }));
}
export const thinkingChoiceKey = (choice: ThinkingChoice): string => choice.effort ?? `budget:${choice.budget}`;

export function reasoningBody(provider: ProviderId, choice: ThinkingChoice | undefined, caps?: ModelCapabilities): Record<string, unknown> {
  if (provider === 'claude') return {
    ...(choice?.effort ? { output_config: { effort: choice.effort } } : {}),
    ...(choice?.budget ? { thinking: { type: 'enabled', budget_tokens: choice.budget } } : {}),
  };
  if (provider === 'openrouter') return choice ? { reasoning: { ...(choice.effort ? { effort: choice.effort } : { max_tokens: choice.budget }) } } : {};
  if (provider === 'gemini') return {
    ...(choice?.effort ? { reasoning_effort: choice.effort } : {}),
    ...(caps?.reasoning ? { extra_body: { google: { thinking_config: { include_thoughts: true, ...(choice?.budget ? { thinking_budget: choice.budget } : {}) } } } } : {}),
  };
  if (!choice) return {};
  if (choice.effort === 'none' && ['deepseek', 'doubao', 'zhipu', 'moonshot'].includes(provider)) return { thinking: { type: 'disabled' } };
  if (choice.effort === 'none' && provider === 'qwen') return { enable_thinking: false };
  if (provider === 'qwen') return { enable_thinking: choice.effort !== 'none', ...(choice.budget ? { thinking_budget: choice.budget } : { reasoning_effort: choice.effort }) };
  return {
    ...(choice.effort ? { reasoning_effort: choice.effort } : {}),
    ...(['deepseek', 'doubao', 'zhipu', 'moonshot'].includes(provider) ? { thinking: { type: choice.effort === 'none' ? 'disabled' : 'enabled' } } : {}),
  };
}
