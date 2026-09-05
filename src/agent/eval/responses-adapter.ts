/**
 * Evaluation adapter for the OpenAI Responses item grammar, implemented with web-standard globals
 * so a harness can intercept `globalThis.fetch`. It rebuilds neutral history into message,
 * function-call, and function-call-output items, streams text/tool/reasoning-summary deltas, handles
 * terminal failure states, and accepts a non-SSE JSON response. Empty reasoning summaries and text
 * items are omitted; tool-result images become a following user message.
 */
import { classify, PROVIDER_SILENCE } from '../core/errors';
import { parseArgs } from '../core/json';
import type { ProviderMessage } from '../core/project-messages';
import type { FinalToolCall, StopReason, StreamEvent, Usage } from '../core/types';
import { redactSecrets } from '../security/redact';
import { retryAfterMsOf, toRawFailure } from '../providers/http-failure';
import type { Adapter, AdapterRequest } from '../providers/types';

/* Responses wire item grammar. */

export type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string };

export type ResponsesInputItem =
  | { role: 'user' | 'assistant'; content: ResponsesContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

interface WireOutputItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  role?: string;
  content?: { type: string; text?: string }[];
  summary?: { type: string; text?: string }[];
}

interface WireResponse {
  status?: string;
  output?: WireOutputItem[];
  usage?: WireUsage;
  incomplete_details?: { reason?: string };
  error?: { message?: string };
}

/* ── conversation projection ────────────────────────────────────────────────────────────────── */

/** Exported for tests. The history as `input` items; see the file header for the grammar. */
export function toResponsesInput(messages: ProviderMessage[]): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: [
          { type: 'input_text', text: m.text },
          ...(m.images ?? []).map((url): ResponsesContentPart => ({ type: 'input_image', image_url: url })),
        ],
      });
    } else if (m.role === 'assistant') {
      // `raw` is deliberately ignored regardless of `sameModel` — see the file header.
      if (m.text !== '') out.push({ role: 'assistant', content: [{ type: 'output_text', text: m.text }] });
      for (const c of m.toolCalls) {
        out.push({ type: 'function_call', call_id: c.callId, name: c.name, arguments: JSON.stringify(c.args) });
      }
    } else {
      for (const r of m.results) {
        out.push({
          type: 'function_call_output',
          call_id: r.callId,
          output: r.isError ? `Error: ${r.content}` : r.content,
        });
      }
      for (const r of m.results) {
        if (!r.image) continue;
        out.push({
          role: 'user',
          content: [
            { type: 'input_text', text: `(tool attachment: ${r.name})` },
            { type: 'input_image', image_url: r.image },
          ],
        });
      }
    }
  }
  return out;
}

/** Exported for tests. The whole request body; `tools` is omitted when empty (the parameter is an
 *  offer, and offering an empty list reads as a refusal risk on gateways that validate it). */
export function toResponsesBody(req: AdapterRequest, stream: boolean): Record<string, unknown> {
  return {
    model: req.model,
    instructions: req.system,
    input: toResponsesInput(req.messages),
    ...(req.tools.length > 0
      ? {
        tools: req.tools.map((t) => ({
          type: 'function', name: t.name, description: t.description, parameters: t.parameters,
        })),
      }
      : {}),
    ...(req.maxOutputTokens !== undefined ? { max_output_tokens: req.maxOutputTokens } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

/* ── response mapping ───────────────────────────────────────────────────────────────────────── */

function usageOf(u: WireUsage): Usage {
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.input_tokens_details?.cached_tokens ?? undefined,
    cacheWrite: u.input_tokens_details?.cache_write_tokens ?? undefined,
  };
}

function stopOf(res: WireResponse, hasCalls: boolean): StopReason {
  if (res.status === 'incomplete' && res.incomplete_details?.reason === 'max_output_tokens') return 'length';
  return hasCalls ? 'tool-calls' : 'stop';
}

/** An error body's message, or the raw text where it is not the `{"error":{"message"}}` shape. */
function errorMessageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch { /* not JSON: the text is the message */ }
  return body;
}

const SSE = /^text\/event-stream/i;

/** The `data:` payloads of an SSE body, one JSON-parsed object per frame, as they arrive. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
        const data = frame.split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data === '' || data === '[DONE]') continue;
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (typeof parsed === 'object' && parsed !== null) yield parsed as Record<string, unknown>;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createResponsesAdapter(opts: {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}): Adapter {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch: typeof globalThis.fetch = (...args) => (opts.fetch ?? globalThis.fetch)(...args);
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
  };
  let synthCounter = 0;

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      try {
        const res = await doFetch(`${base}/v1/responses`, {
          method: 'POST',
          headers,
          body: JSON.stringify(toResponsesBody(req, true)),
          signal,
        });
        if (!res.ok) {
          const body = await res.text();
          yield {
            t: 'error',
            error: classify({
              status: res.status,
              message: redactSecrets(errorMessageOf(body)),
              retryAfterMs: retryAfterMsOf(res.headers),
            }),
          };
          return;
        }

        /** callId by output item id: `function_call_arguments.delta` frames name only the item. */
        const callIdByItem = new Map<string, string>();
        const argsByItem = new Map<string, string>();
        const callIdFor = (item: WireOutputItem): string => {
          const known = item.id !== undefined ? callIdByItem.get(item.id) : undefined;
          return known ?? item.call_id ?? `call-resp-${synthCounter++}`;
        };
        let snapshot: WireResponse | undefined;
        let failed = false;

        if (SSE.test(res.headers.get('content-type') ?? '') && res.body) {
          for await (const ev of sseData(res.body)) {
            const type = ev.type;
            if (type === 'response.output_item.added') {
              const item = ev.item as WireOutputItem | undefined;
              if (item?.type === 'function_call' && typeof item.name === 'string') {
                const callId = item.call_id ?? `call-resp-${synthCounter++}`;
                if (item.id !== undefined) callIdByItem.set(item.id, callId);
                yield { t: 'tool-start', callId, name: item.name };
                // A gateway may open the item with its whole arguments already in it.
                if (typeof item.arguments === 'string' && item.arguments !== '') {
                  if (item.id !== undefined) argsByItem.set(item.id, item.arguments);
                  yield { t: 'tool-args', callId, delta: item.arguments };
                }
              }
            } else if (type === 'response.function_call_arguments.delta') {
              const itemId = typeof ev.item_id === 'string' ? ev.item_id : undefined;
              const callId = itemId !== undefined ? callIdByItem.get(itemId) : undefined;
              if (callId !== undefined && typeof ev.delta === 'string' && ev.delta !== '') {
                if (itemId !== undefined) argsByItem.set(itemId, (argsByItem.get(itemId) ?? '') + ev.delta);
                yield { t: 'tool-args', callId, delta: ev.delta };
              }
            } else if (type === 'response.output_text.delta') {
              if (typeof ev.delta === 'string' && ev.delta !== '') yield { t: 'text', delta: ev.delta };
            } else if (type === 'response.reasoning_summary_text.delta') {
              // This gateway's summaries arrive empty; only words are a thought.
              if (typeof ev.delta === 'string' && ev.delta.trim() !== '') yield { t: 'reasoning', delta: ev.delta };
            } else if (type === 'response.completed' || type === 'response.incomplete') {
              snapshot = ev.response as WireResponse;
            } else if (type === 'response.failed') {
              snapshot = ev.response as WireResponse;
              failed = true;
            } else if (type === 'error') {
              const message = typeof ev.message === 'string' ? ev.message : JSON.stringify(ev);
              yield { t: 'error', error: classify({ message: redactSecrets(message) }) };
              return;
            }
          }
        } else {
          // One JSON body for a stream request: the completed response, delivered whole.
          snapshot = await res.json() as WireResponse;
          for (const item of snapshot.output ?? []) {
            if (item.type === 'reasoning') {
              const summary = (item.summary ?? [])
                .map((s) => s.text ?? '').join('').trim();
              if (summary !== '') yield { t: 'reasoning', delta: summary };
            } else if (item.type === 'message') {
              const text = (item.content ?? [])
                .filter((c) => c.type === 'output_text')
                .map((c) => c.text ?? '').join('');
              if (text !== '') yield { t: 'text', delta: text };
            } else if (item.type === 'function_call' && typeof item.name === 'string') {
              const callId = callIdFor(item);
              if (item.id !== undefined) callIdByItem.set(item.id, callId);
              yield { t: 'tool-start', callId, name: item.name };
              if (typeof item.arguments === 'string' && item.arguments !== '') {
                yield { t: 'tool-args', callId, delta: item.arguments };
              }
            }
          }
        }

        if (snapshot === undefined) {
          yield { t: 'error', error: classify({ message: PROVIDER_SILENCE }) };
          return;
        }
        if (failed) {
          const message = snapshot.error?.message ?? 'The provider reported the response failed.';
          yield { t: 'error', error: classify({ message: redactSecrets(message) }) };
          return;
        }

        // The terminal snapshot's output array is authoritative for the finals, over whatever the
        // deltas accumulated (the same division anthropic.ts draws with finalMessage()).
        const final: FinalToolCall[] = [];
        for (const item of snapshot.output ?? []) {
          if (item.type !== 'function_call' || typeof item.name !== 'string') continue;
          const rawArgs = typeof item.arguments === 'string' && item.arguments !== ''
            ? item.arguments
            : (item.id !== undefined ? argsByItem.get(item.id) : undefined) ?? '';
          final.push({ callId: callIdFor(item), name: item.name, args: parseArgs(rawArgs), rawArgs });
        }
        const usage = snapshot.usage !== undefined ? usageOf(snapshot.usage) : undefined;
        yield {
          t: 'done',
          stop: stopOf(snapshot, final.length > 0),
          ...(final.length > 0 ? { final } : {}),
          ...(usage !== undefined ? { usage } : {}),
        };
      } catch (err) {
        const error = classify(toRawFailure(err, signal.aborted));
        if (error.cls === 'abort') yield { t: 'done', stop: 'aborted' };
        else yield { t: 'error', error };
      }
    },

    async listModels(signal: AbortSignal): Promise<string[]> {
      const res = await doFetch(`${base}/v1/models`, { headers, signal });
      if (!res.ok) throw new Error(`models list failed (${res.status}): the gateway serves no catalog at /v1/models.`);
      const parsed = await res.json() as { data?: { id?: string }[] };
      return (parsed.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    },
  };
}
