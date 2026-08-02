/**
 * OpenAI-compatible provider adapter — official `openai` SDK, browser mode.
 * Serves BOTH OpenAI (default baseURL) and DeepSeek (baseURL switch in
 * providers/index.ts); DeepSeek's chat-completions + tools + GET /models are
 * OpenAI-compatible. Streaming accumulates tool_call argument deltas by index.
 */
import OpenAI from 'openai';
import type { AgentMessage, AgentRequest, AssistantTurn, ProviderAdapter, StreamCallbacks } from '../types';

/** Exported for tests. */
export function toOpenAIMessages(system: string, messages: AgentMessage[]): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls.length > 0 && {
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          })),
        }),
      });
    } else {
      // Deliberate two-pass split: every tool_call_id MUST be answered by a
      // role:'tool' message before any role:'user' message appears, or the API
      // rejects the request. Do not merge these into a single interleaved loop.
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      for (const r of m.results) {
        if (!r.image) continue;
        // OpenAI-compatible APIs reject images inside tool messages — deliver the
        // render as an immediate user message instead.
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: '(tool attachment: rendered map image from view_map)' },
            { type: 'image_url', image_url: { url: r.image.dataUrl } },
          ],
        });
      }
    }
  }
  return out;
}

function safeParse(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * The SDK's telemetry headers, cleared (`null` removes a header in the SDK's header model).
 *
 * Each is a non-standard header name, so sending them makes the browser preflight every call and
 * ask the endpoint to allow all six by name. Endpoints that allowlist header names answer such a
 * preflight with no CORS headers at all, and the browser then reports the request as having no
 * `Access-Control-Allow-Origin`. Moonshot answers that way, as do self-hosted and gateway
 * endpoints; with Authorization alone every provider here is reachable from a browser.
 */
const NO_TELEMETRY_HEADERS: Record<string, null> = Object.fromEntries(
  ['arch', 'lang', 'os', 'package-version', 'retry-count', 'runtime', 'runtime-version', 'timeout']
    .map((n) => [`x-stainless-${n}`, null]),
);

export function createOpenAIAdapter(apiKey: string, baseURL?: string): ProviderAdapter {
  const client = new OpenAI({
    apiKey, baseURL, dangerouslyAllowBrowser: true, defaultHeaders: NO_TELEMETRY_HEADERS,
  });
  return {
    async listModels() {
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids.sort();
    },

    async stream(req: AgentRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<AssistantTurn> {
      const stream = await client.chat.completions.create(
        {
          model: req.model,
          stream: true,
          messages: toOpenAIMessages(req.system, req.messages),
          tools: req.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
        },
        { signal },
      );
      let text = '';
      const calls = new Map<number, { id: string; name: string; args: string }>();
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          cb.onTextDelta(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const e = calls.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) e.id = tc.id;
          if (tc.function?.name) {
            e.name = tc.function.name;
            cb.onToolCallStart?.(e.name);
          }
          if (tc.function?.arguments) e.args += tc.function.arguments;
          calls.set(tc.index, e);
        }
      }
      const toolCalls = [...calls.values()]
        .filter((c) => c.id)
        .map((c) => ({ id: c.id, name: c.name, input: safeParse(c.args) }));
      return { text, toolCalls };
    },
  };
}
