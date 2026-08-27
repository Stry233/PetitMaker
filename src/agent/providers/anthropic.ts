/**
 * The Anthropic adapter — official @anthropic-ai/sdk, browser mode. The ONLY file in
 * providers/ that imports the SDK, so the loop and every other adapter stay SDK-free.
 *
 * Wire-shape facts (tool_result batching into one user message, image nesting inside a
 * tool_result block, the system cache_control breakpoint, adaptive thinking,
 * `dangerouslyAllowBrowser`) are production-proven. The generator
 * NEVER throws (every failure, abort included, ends the stream with one terminal event instead
 * of rejecting); the raw content-block echo is gated on `sameModel` — a Claude turn's
 * raw bytes (thinking signatures, exact tool_use shape) are provider-specific and replaying them
 * against a different provider or model would misreport what actually produced them; and the
 * conversation carries a cache breakpoint of its own (`withConversationBreakpoint`) beside the
 * system prefix's.
 *
 * The raw-failure/retry-after mapping (`./http-failure`, which redacts the detail through
 * `../security/redact`) is shared verbatim with the OpenAI-dialect adapter, since neither a
 * leaked key nor a `Retry-After` header's shape is an Anthropic-specific risk.
 *
 * This dialect carries no `Quirks` value of its own: `imageInToolResult` exists in the quirks
 * table only to describe the OpenAI dialect's per-provider variation, and this file's wire shape
 * (image nested inside a tool_result block) serves exactly one provider, whose value is fixed
 * true, so there is nothing here for a quirks flag to select between.
 */
import Anthropic from '@anthropic-ai/sdk';
import { classify } from '../core/errors';
import type { ProviderMessage } from '../core/project-messages';
import type { FinalToolCall, StopReason, StreamEvent, Usage } from '../core/types';
import { toRawFailure } from './http-failure';
import type { Adapter, AdapterRequest } from './types';

/** Thinking and the answer share this budget. Adaptive thinking is sent unconditionally, so a
 *  ceiling low enough for the answer alone stops a long think at `max_tokens` — the turn ends
 *  'length' with nothing usable in it, and the next one re-thinks the same wall. */
const DEFAULT_MAX_TOKENS = 32000;

/** The block types that accept `cache_control`. `thinking` does not, so a raw echo ending in one
 *  cannot hold the breakpoint. */
const MARKABLE = new Set(['text', 'tool_result', 'tool_use', 'image']);

/** `data:<mime>;base64,<data>` -> its two parts; an unrecognized shape is treated as already-bare
 *  base64 data (never throws on a malformed string, since a bad image is not worth failing the turn). */
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

/** Exported for tests. */
export function toAnthropicMessages(messages: ProviderMessage[], sameModel: boolean): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'user') return { role: 'user', content: userContent(m.text, m.images) };
    if (m.role === 'assistant') {
      if (m.raw !== undefined && sameModel) return { role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] };
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
 * The second cache breakpoint, on the LAST markable block of the history (the first is on the
 * system+tools prefix). A breakpoint caches everything BEFORE it, so one that moves to the tail
 * each turn writes the turn just added and reads everything older — the incremental-prefix
 * pattern. Without it only tools+system were cached and the whole conversation was reprocessed at
 * full price every turn. Two breakpoints total, against an API ceiling of four.
 *
 * Copy-on-write: `raw` echo blocks are the same objects the log holds, so the marked block is a
 * fresh spread and the input array is never touched. Exported for tests.
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
  return 'stop'; // end_turn, stop_sequence, pause_turn, refusal, null
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
            thinking: { type: 'adaptive' },
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

        // Text/thinking/tool-arg deltas all stream live off the raw wire events. A tool_use
        // block's `index` is the only handle its later input_json_delta chunks carry, so the
        // index->callId map recorded at content_block_start is what lets each chunk name its
        // call; finalMessage() below is authoritative ONLY for the parsed `final` args + `raw`,
        // never for what already went out live.
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
        const error = classify(toRawFailure(err, signal.aborted));
        if (error.cls === 'abort') yield { t: 'done', stop: 'aborted' };
        else yield { t: 'error', error };
      }
    },

    async listModels(signal: AbortSignal): Promise<string[]> {
      const ids: string[] = [];
      for await (const m of client.models.list(null, { signal })) ids.push(m.id);
      return ids;
    },
  };
}
