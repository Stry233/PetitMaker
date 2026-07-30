/**
 * Claude provider adapter — official @anthropic-ai/sdk, browser mode.
 *
 * The agent loop is manual (not the SDK tool-runner) because tool calls route
 * through the editor's CommandExecutor for validation feedback. The static
 * system prompt carries a cache_control breakpoint so the big rules/catalog
 * prefix caches across turns; adaptive thinking is on, and the assistant
 * turn's raw content blocks (thinking signatures + tool_use) are echoed back
 * verbatim via AgentMessage.raw — required for thinking + tool use.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AgentMessage, AgentRequest, AssistantTurn, ProviderAdapter, StreamCallbacks } from '../types';

/** Exported for tests. */
export function toAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'assistant') {
      if (m.raw) return { role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] };
      return { role: 'assistant', content: m.content || '(no text)' };
    }
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.toolCallId,
        is_error: r.isError,
        content: r.image
          ? [
              { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: r.image.dataUrl.split(',')[1] ?? '' } },
              { type: 'text' as const, text: r.content },
            ]
          : r.content,
      })),
    };
  });
}

export function createAnthropicAdapter(apiKey: string): ProviderAdapter {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return {
    async listModels() {
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    },

    async stream(req: AgentRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<AssistantTurn> {
      const stream = client.messages.stream(
        {
          model: req.model,
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
          })),
          messages: toAnthropicMessages(req.messages),
        },
        { signal },
      );
      stream.on('text', (d) => cb.onTextDelta(d));
      stream.on('contentBlock', (b) => {
        if (b.type === 'tool_use') cb.onToolCallStart?.(b.name);
      });
      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolCalls = final.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));
      return { text, toolCalls, raw: final.content };
    },
  };
}
