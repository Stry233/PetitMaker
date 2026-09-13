/**
 * Anthropic's browser SDK adapter and the sole provider module that imports its SDK.
 * It owns Anthropic's tool-result, image, thinking and cache-control wire shapes. Raw content
 * blocks replay only to the same model because their signatures and tool-use shapes are
 * provider-specific. Errors and aborts become terminal stream events.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ProviderMessage } from '../core/project-messages';
import type { FinalToolCall, StopReason, StreamEvent, Usage } from '../core/types';
import { streamFailureEvent } from './http-failure';
import { reasoningBody } from './reasoning';
import type { Adapter, AdapterRequest } from './types';

/** Adaptive thinking and the answer share this budget. */
const DEFAULT_MAX_TOKENS = 32000;

/** Anthropic permits `cache_control` on these content block types. */
const MARKABLE = new Set(['text', 'tool_result', 'tool_use', 'image']);

/** Splits a data URL; an unrecognized value is treated as bare PNG base64. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  return match ? { mediaType: match[1] ?? 'image/png', data: match[2] ?? '' } : { mediaType: 'image/png', data: dataUrl };
}

function imageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const { mediaType, data } = parseDataUrl(dataUrl);
  return { type: 'image', source: { type: 'base64', media_type: mediaType as Anthropic.Base64ImageSource['media_type'], data } };
}

function userContent(text: string, images: string[] | undefined): Anthropic.MessageParam['content'] {
  if (!images || images.length === 0) return text;
  return [...images.map(imageBlock), { type: 'text', text }];
}

function assistantContent(
  text: string,
  toolCalls: { callId: string; name: string; args: Record<string, unknown> }[],
): Anthropic.ContentBlockParam[] | string {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (text) blocks.push({ type: 'text', text });
  for (const call of toolCalls) blocks.push({ type: 'tool_use', id: call.callId, name: call.name, input: call.args });
  return blocks.length > 0 ? blocks : '(no text)';
}

export function toAnthropicMessages(messages: ProviderMessage[], sameModel: boolean): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'user') return { role: 'user', content: userContent(m.text, m.images) };
    if (m.role === 'assistant') {
      if (Array.isArray(m.raw) && sameModel) return { role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] };
      return { role: 'assistant', content: assistantContent(m.text, m.toolCalls) };
    }
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.callId,
        is_error: r.isError,
        content: r.image ? [imageBlock(r.image), { type: 'text' as const, text: r.content }] : r.content,
      })),
    };
  });
}

/**
 * Places the conversation's cache breakpoint on its last eligible block. The system prefix owns
 * the other breakpoint. Raw echo blocks may be shared with the log, so marking is copy-on-write.
 */
export function withConversationBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (typeof m.content === 'string') {
      const marked = [...messages];
      marked[i] = { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
      return marked;
    }
    const last = m.content[m.content.length - 1];
    if (last && MARKABLE.has(last.type)) {
      const marked = [...messages];
      marked[i] = {
        ...m,
        content: [...m.content.slice(0, -1), { ...last, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam],
      };
      return marked;
    }
  }
  return messages;
}

function mapStop(reason: Anthropic.Message['stop_reason']): StopReason {
  if (reason === 'tool_use') return 'tool-calls';
  if (reason === 'max_tokens') return 'length';
  return 'stop'; // All remaining terminal reasons end the turn without tool calls.
}

function usageOf(u: Anthropic.Message['usage']): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? undefined,
    cacheWrite: u.cache_creation_input_tokens ?? undefined,
  };
}

export function createAnthropicAdapter(opts: { apiKey: string }): Adapter {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, dangerouslyAllowBrowser: true });

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      try {
        const sdkStream = client.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
            ...(req.capabilities?.reasoning && !req.capabilities.budget ? { thinking: { type: 'adaptive' as const } } : {}),
            ...reasoningBody('claude', req.thinking, req.capabilities),
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Tool['input_schema'],
            })),
            messages: withConversationBreakpoint(toAnthropicMessages(req.messages, req.sameModel)),
          },
          { signal },
        );

        // Input JSON deltas carry only a block index, so retain the tool ID from block start.
        // finalMessage() supplies the parsed arguments and raw echo after live deltas are emitted.
        const callIdByIndex = new Map<number, string>();
        for await (const event of sdkStream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            callIdByIndex.set(event.index, event.content_block.id);
            yield { t: 'tool-start', callId: event.content_block.id, name: event.content_block.name };
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') yield { t: 'text', delta: event.delta.text };
            else if (event.delta.type === 'thinking_delta') yield { t: 'reasoning', delta: event.delta.thinking };
            else if (event.delta.type === 'input_json_delta') {
              const callId = callIdByIndex.get(event.index);
              if (callId !== undefined) yield { t: 'tool-args', callId, delta: event.delta.partial_json };
            }
          }
        }

        const final = await sdkStream.finalMessage();
        const finalCalls: FinalToolCall[] = [];
        for (const block of final.content) {
          if (block.type !== 'tool_use') continue;
          const args = block.input as Record<string, unknown>;
          const rawArgs = JSON.stringify(args);
          finalCalls.push({ callId: block.id, name: block.name, args, rawArgs });
        }

        yield {
          t: 'done',
          stop: mapStop(final.stop_reason),
          usage: usageOf(final.usage),
          raw: final.content,
          final: finalCalls,
        };
      } catch (err) {
        yield streamFailureEvent(err, signal.aborted, [opts.apiKey]);
      }
    },

    async listModels(signal: AbortSignal): Promise<string[]> {
      const ids: string[] = [];
      for await (const m of client.models.list(null, { signal })) ids.push(m.id);
      return ids;
    },
  };
}
