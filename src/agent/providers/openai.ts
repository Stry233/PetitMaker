/**
 * Browser adapter for the registered OpenAI-compatible providers.
 *
 * Tool results precede any follow-up image messages. Streamed tool-call fragments are joined by
 * chunk index, with call id as a fallback. A response containing only a requested tool-call object
 * is normalized to a tool call, and that endpoint uses non-streaming requests thereafter.
 * Neutral history retains recognized thinking fields and tool signatures for same-model replay.
 */
import OpenAI from 'openai';
import { classify, NO_ENDPOINT_ADDRESS, PROVIDER_SILENCE } from '../core/errors';
import { parseArgs } from '../core/json';
import type { ProviderMessage } from '../core/project-messages';
import type { FinalToolCall, StopReason, StreamEvent, TurnQuirk, Usage } from '../core/types';
import { QUIRKS, PROVIDER_IDS, type ProviderId, type Quirks } from './defaults';
import { modelCapabilities, rememberNativeModels } from './model-catalog';
import { ChatReasoning, savedChat } from './chat-reasoning';
import { reasoningBody } from './reasoning';
import { streamFailureEvent } from './http-failure';
import type { Adapter, AdapterRequest } from './types';

/**
 * The SDK's telemetry headers, cleared (`null` removes a header in the SDK's header model).
 *
 * Each is a non-standard header name, so sending them makes the browser preflight every call and
 * ask the endpoint to allow all of them by name. Endpoints that allowlist header names answer such
 * a preflight with no CORS headers at all, and the browser then reports the request as having no
 * `Access-Control-Allow-Origin`. Moonshot answers that way, as do self-hosted and gateway
 * endpoints; with Authorization alone every provider here is reachable from a browser.
 */
const NO_TELEMETRY_HEADERS: Record<string, null> = Object.fromEntries(
  ['arch', 'lang', 'os', 'package-version', 'retry-count', 'runtime', 'runtime-version', 'timeout']
    .map((n) => [`x-stainless-${n}`, null]),
);

function userContent(text: string, images: string[] | undefined): OpenAI.ChatCompletionUserMessageParam['content'] {
  if (!images || images.length === 0) return text;
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
}

/** Converts neutral session history to the provider wire format. */
export function toOpenAIMessages(system: string, messages: ProviderMessage[], imageInToolResult = false, sameModel = false, endpoint?: string): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContent(m.text, m.images) });
    } else if (m.role === 'assistant') {
      const saved = sameModel ? savedChat(m.raw) : undefined;
      const raw = endpoint === undefined || saved?.endpoint === endpoint ? saved : undefined;
      // NEVER `content: null`: the spec makes content optional only beside tool_calls, and a strict
      // gateway rejects an explicit null either way. Empty text is the field omitted where calls
      // carry the turn, and an empty string where nothing else would.
      const msg: OpenAI.ChatCompletionAssistantMessageParam = { role: 'assistant' };
      if (m.text !== '') msg.content = m.text;
      else if (m.toolCalls.length === 0) msg.content = '';
      if (m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.callId,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      }
      if (raw) {
        Object.assign(msg, raw.fields);
        for (const call of msg.tool_calls ?? []) {
          const extra = raw.calls.find((item) => item.callId === call.id)?.extra;
          if (extra) Object.assign(call, { extra_content: extra });
        }
      }
      out.push(msg);
    } else {
      // Two passes, never one interleaved loop: every tool_call_id MUST be answered by a
      // role:'tool' message before any role:'user' message appears, or the API rejects the
      // request. The wire has no is_error flag, so an error result is named in its own text.
      for (const r of m.results) {
        const text = r.isError ? `Error: ${r.content}` : r.content;
        if (imageInToolResult && r.image) {
          out.push({
            role: 'tool',
            tool_call_id: r.callId,
            // The stock SDK type models only text parts inside a tool message (no provider this
            // dialect serves today sets imageInToolResult), so this branch's shape is asserted.
            content: [
              { type: 'text', text },
              { type: 'image_url', image_url: { url: r.image } },
            ] as unknown as OpenAI.ChatCompletionContentPartText[],
          });
        } else {
          out.push({ role: 'tool', tool_call_id: r.callId, content: text });
        }
      }
      if (!imageInToolResult) {
        for (const r of m.results) {
          if (!r.image) continue;
          // The OpenAI-compatible wire rejects an image inside a tool message on every provider
          // this dialect serves today — deliver it as an immediate follow-up user message instead.
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: `(tool attachment: ${r.name})` },
              { type: 'image_url', image_url: { url: r.image } },
            ],
          });
        }
      }
    }
  }
  return out;
}

function mapStop(reason: OpenAI.ChatCompletionChunk.Choice['finish_reason']): StopReason {
  if (reason === 'length') return 'length';
  if (reason === 'tool_calls') return 'tool-calls';
  return 'stop'; // 'stop', 'content_filter', 'function_call', null
}

interface CallBuffer { callId: string; name: string; args: string }

function usageOf(u: OpenAI.CompletionUsage): Usage {
  return {
    input: u.prompt_tokens,
    output: u.completion_tokens,
    cacheRead: u.prompt_tokens_details?.cached_tokens ?? undefined,
  };
}

/**
 * A gateway that does not know `stream_options` refuses the WHOLE request rather than ignoring the
 * parameter: an OpenAI-shaped endpoint answers 400 `Unrecognized request argument supplied:
 * stream_options`, a schema-validated one (FastAPI and the gateways built on it) answers 422
 * `extra fields not permitted`. Both name the parameter or the class of complaint, which is what
 * lets the retry below tell them from a real 400 (a bad model id, a malformed tool schema) it must
 * not swallow.
 */
const STREAM_OPTIONS_REJECTION = /stream_options|extra fields not permitted/i;

function refusesStreamOptions(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown } | null;
  if (e?.status !== 400 && e?.status !== 422) return false;
  return typeof e.message === 'string' && STREAM_OPTIONS_REJECTION.test(e.message);
}

/** A tool call the model typed into its message body instead of the tool_calls channel. */
interface ProseCall { name: string; args: Record<string, unknown>; rawArgs: string }

/** `arguments` as an object: the wire carries it either as JSON or as a JSON STRING, and models
 *  emitting a call in prose use both spellings. Absent reads as no arguments, which is a legal call
 *  for a tool whose parameters are all optional. */
function proseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') return raw.trim() === '' ? {} : parseArgs(raw);
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/**
 * A MESSAGE BODY THAT IS ONE TOOL CALL, or undefined for ordinary prose.
 *
 * Exported for tests. The three conditions together are what make a false positive impossible: the
 * WHOLE body must parse as one JSON object (not a fenced snippet inside a sentence, not an array),
 * `name` must be a tool the request actually offered, and `arguments` must be an object or a JSON
 * string that is one. A model answering in words about `place_object` writes a sentence, not this.
 */
export function toolCallInProse(text: string, toolNames: ReadonlySet<string>): ProseCall | undefined {
  const body = text.trim();
  if (!body.startsWith('{') || !body.endsWith('}')) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const { name, arguments: rawArgs } = parsed as { name?: unknown; arguments?: unknown };
  if (typeof name !== 'string' || !toolNames.has(name)) return undefined;
  const args = proseArgs(rawArgs);
  if (!args) return undefined;
  return { name, args, rawArgs: JSON.stringify(args) };
}

/** Whether the text so far could still GROW into the whole-body JSON object a prose call is: empty,
 *  whitespace, or opened with a brace. Anything else is prose and streams from the next delta on. */
function couldBeProseCall(text: string): boolean {
  const head = text.trimStart();
  return head === '' || head.startsWith('{');
}

/** How much brace-opened text is held back before it is published as prose regardless. A call the
 *  model typed out is a few hundred characters; past this the body is an answer that happens to
 *  start with a brace, and holding an answer back is worse than publishing one late. */
const PROSE_HOLD_MAX = 8192;

/**
 * Endpoints observed answering a STREAMED request with a tool call typed into the message body, by
 * base URL. The next request to one of them is sent UNSTREAMED, where the same gateway sends a
 * proper `tool_calls` array (the L1 probe: one endpoint, one body, both answers).
 *
 * Module-scoped rather than per adapter: `exec/runner.ts` builds a fresh adapter for every job, so
 * an instance-scoped memory would spend the first turn of every order learning the same fact again.
 * Never cleared, for the reason `usageParamRefused` is never cleared — a gateway that cannot carry
 * tool calls on its streaming path cannot carry them on the next turn either.
 */
const PROSE_ENDPOINTS = new Set<string>();

export function createOpenAIAdapter(opts: { apiKey: string; baseUrl?: string; providerId?: ProviderId; quirks: Quirks }): Adapter {
  // A PROVIDER WHOSE HOST IS THE USER'S OWN IS NEVER BUILT WITHOUT IT (`Quirks.needsBaseUrl`). The
  // SDK's default host is another company's API and the key was issued by whatever runs at the
  // user's address, so no client exists on this path at all — the throw is the floor under every
  // readiness gate above it, and its wording classifies as `config` (`core/errors.ts`).
  if (opts.quirks.needsBaseUrl === true && (opts.baseUrl ?? '') === '') throw new Error(NO_ENDPOINT_ADDRESS);
  const client = new OpenAI({
    apiKey: opts.apiKey,
    // undefined is SDK-legal here and takes the SDK's own default endpoint — the `openai`
    // provider's `baseUrlFor` deliberately returns undefined (see defaults.ts).
    baseURL: opts.baseUrl,
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    defaultHeaders: NO_TELEMETRY_HEADERS,
  });
  const providerId = opts.providerId ?? PROVIDER_IDS.find((id) => QUIRKS[id] === opts.quirks) ?? 'custom';
  const reasoningFields = opts.quirks.reasoningFields ?? [];
  const imageInToolResult = opts.quirks.imageInToolResult;
  const streamUsage = opts.quirks.streamUsage === true;
  // Per-ADAPTER-instance, not per-stream: a fresh counter on every `stream()` call let two
  // different turns both mint `call-0-0` for their first id-less tool call, and every later
  // callId-keyed lookup (the loop's gate/result tracking, project-messages' replay maps) then
  // silently treated the two turns' distinct calls as the same occurrence.
  let synthCounter = 0;
  // Set by the one self-heal below and never cleared: an endpoint that refuses `stream_options`
  // refuses it every turn, so re-offering it would spend a rejected roundtrip per turn forever.
  let usageParamRefused = false;
  /** This adapter's row in `PROSE_ENDPOINTS`. The SDK's own default endpoint is one endpoint like
   *  any other, so an omitted base URL keys on the empty string rather than opting out. */
  const endpointKey = opts.baseUrl ?? '';

  /**
   * ONE TURN, UNSTREAMED: the request an endpoint gets once it has shown it cannot carry a tool call
   * on its streaming path, mapped onto the same events the streamed path emits.
   *
   * Usage rides in the response body here, so `stream_options` (and its self-heal) has nothing to
   * do; the idle bound is the loop's `withIdleTimeout` either way, which now measures the whole
   * answer against its first-event budget rather than the gap between deltas.
   */
  async function* unstreamed(
    params: OpenAI.ChatCompletionCreateParamsNonStreaming, toolNames: ReadonlySet<string>, signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const res = await client.chat.completions.create(params, { signal });
    const choice = res.choices[0];
    if (!choice) {
      yield { t: 'error', error: classify({ message: PROVIDER_SILENCE }) };
      return;
    }
    const message = choice.message as OpenAI.ChatCompletionMessage & { [key: string]: unknown };
    const thinking = new ChatReasoning(reasoningFields, endpointKey);
    for (const thought of thinking.add(message)) yield { t: 'reasoning', delta: thought };
    for (const call of message.tool_calls ?? []) thinking.tool(call.id, (call as unknown as Record<string, unknown>).extra_content);
    const wireCalls = (message.tool_calls ?? [])
      .filter((c): c is OpenAI.ChatCompletionMessageFunctionToolCall => c.type === 'function')
      .map((c) => ({ callId: c.id, name: c.function.name, rawArgs: c.function.arguments }));
    const text = message.content ?? '';
    const prose = wireCalls.length === 0 && choice.finish_reason !== 'length'
      ? toolCallInProse(text, toolNames)
      : undefined;
    if (prose === undefined && text !== '') yield { t: 'text', delta: text };
    const calls = prose !== undefined
      ? [{ callId: `call-prose-${synthCounter++}`, name: prose.name, rawArgs: prose.rawArgs }]
      : wireCalls;
    const final: FinalToolCall[] = [];
    for (const call of calls) {
      yield { t: 'tool-start', callId: call.callId, name: call.name };
      if (call.rawArgs) yield { t: 'tool-args', callId: call.callId, delta: call.rawArgs };
      final.push({ callId: call.callId, name: call.name, args: parseArgs(call.rawArgs), rawArgs: call.rawArgs });
    }
    const usage = res.usage ? usageOf(res.usage) : undefined;
    yield {
      t: 'done',
      stop: prose !== undefined ? 'tool-calls' : mapStop(choice.finish_reason),
      final,
      ...(thinking.raw() ? { raw: thinking.raw() } : {}),
      ...(usage !== undefined && { usage }),
      ...(prose !== undefined && { quirks: ['tool-call-as-prose' as TurnQuirk] }),
    };
  }

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      const toolNames = new Set(req.tools.map((t) => t.name));
      try {
        const capabilities = req.capabilities ?? modelCapabilities(providerId, req.model, opts.baseUrl);
        if ((!opts.baseUrl || /^https:\/\/api\.openai\.com\/v1\/?$/.test(opts.baseUrl))
          && (capabilities?.reasoning || /^(?:gpt-(?:[5-9]|[1-9]\d)|o[1-9])/.test(req.model))) {
          const { streamResponses } = await import('./openai-responses');
          yield* streamResponses(client, { ...req, capabilities }, signal, opts.apiKey);
          return;
        }
        const base: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model: req.model,
          ...reasoningBody(providerId, req.thinking, capabilities),
          ...(req.maxOutputTokens === undefined ? {} : /^(gpt-[5-9]|o[1-9])/.test(req.model)
            ? { max_completion_tokens: req.maxOutputTokens } : { max_tokens: req.maxOutputTokens }),
          messages: toOpenAIMessages(req.system, req.messages, imageInToolResult, req.sameModel, endpointKey),
          ...(req.tools.length ? { tools: req.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })) } : {}),
        };
        if (PROSE_ENDPOINTS.has(endpointKey)) {
          yield* unstreamed(base, toolNames, signal);
          return;
        }
        const params: OpenAI.ChatCompletionCreateParamsStreaming = { ...base, stream: true };
        const askUsage = streamUsage && !usageParamRefused;
        let sdkStream;
        try {
          sdkStream = await client.chat.completions.create(
            askUsage ? { ...params, stream_options: { include_usage: true } } : params,
            { signal },
          );
        } catch (err) {
          // Usage is a statistic; the stream is the product. An endpoint that rejects the
          // parameter loses the turn outright otherwise, and the refusal classifies 'unknown', so
          // the user would be told only that something went wrong. Drop the ask and go again once.
          if (!askUsage || signal.aborted || !refusesStreamOptions(err)) throw err;
          usageParamRefused = true;
          sdkStream = await client.chat.completions.create(params, { signal });
        }

        // A tool call's chunk `index` is the fragment handle on the standard wire; the buffer keyed
        // on it is what lets interleaved calls (two tools issued back-to-back) accumulate without
        // cross-contaminating each other's name/args. A vLLM-style gateway (Ivy) streams each call
        // COMPLETE in its own chunk — id + name + whole arguments, a cumulative `message` object
        // beside the `delta`, and NO index — so the key falls back to the call id there, and to a
        // fresh key per entry where neither exists (nothing could correlate a later fragment to it).
        // Keyed on the absent index alone, a whole turn's calls merged into one buffer of
        // concatenated JSON: one bad call reported, every real one lost. `startedCalls` gates
        // `tool-start` to once per key, since a gateway can repeat the name on a later chunk of the
        // same call.
        const thinking = new ChatReasoning(reasoningFields, endpointKey);
        const buffers = new Map<string, CallBuffer>();
        const startedCalls = new Set<string>();
        let keylessCalls = 0;
        let finishReason: OpenAI.ChatCompletionChunk.Choice['finish_reason'] = null;
        let usage: Usage | undefined;
        // Whether anything the MODEL produced came down the wire: text, thought or tool call.
        // Usage is not content — a trailing usage-only frame says how big the nothing was.
        let said = false;
        /**
         * TEXT THAT COULD STILL BE A TOOL CALL IS HELD, and only that text.
         *
         * The deltas are kept individually so a release replays the stream as it arrived rather than
         * coalescing it into one event. A body that is not brace-opened releases on its FIRST delta,
         * which is every prose answer there is; a brace-opened one is held to the end of the turn,
         * where it is either the call it looks like or published as the answer it turned out to be.
         * Publishing it as it arrives is what made the JSON the assistant's own words.
         */
        const held: string[] = [];
        let holdText = '';
        let holding = true;

        for await (const chunk of sdkStream) {
          // Read usage BEFORE the choice guard: `include_usage` delivers it on a trailing chunk
          // whose `choices` array is empty, so a guard-first loop discards the only chunk carrying it.
          if (chunk.usage) usage = usageOf(chunk.usage);
          const choice = chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta as OpenAI.ChatCompletionChunk.Choice.Delta & { [key: string]: unknown };
          if (delta.content) {
            said = true;
            if (holding) {
              held.push(delta.content);
              holdText += delta.content;
              holding = holdText.length <= PROSE_HOLD_MAX && couldBeProseCall(holdText);
              if (!holding) {
                for (const d of held) yield { t: 'text', delta: d };
                held.length = 0;
              }
            } else {
              yield { t: 'text', delta: delta.content };
            }
          }
          for (const thought of thinking.add(delta)) { said = true; yield { t: 'reasoning', delta: thought }; }
          for (const tc of (delta.tool_calls ?? []) as { index?: number; id?: string; extra_content?: unknown; function?: { name?: string; arguments?: string } }[]) {
            said = true;
            const key = tc.index !== undefined ? `i${tc.index}` : tc.id !== undefined ? `d${tc.id}` : `k${keylessCalls++}`;
            let entry = buffers.get(key);
            if (!entry) {
              // A gateway that never sends an id at all still gets one call executed, never
              // dropped: `call-<index>-<n>`, synthesized unconditionally regardless of provider.
              entry = { callId: tc.id ?? `call-${tc.index ?? 'x'}-${synthCounter++}`, name: '', args: '' };
              buffers.set(key, entry);
            }
            thinking.tool(entry.callId, tc.extra_content);
            if (tc.function?.name && !startedCalls.has(key)) {
              entry.name = tc.function.name;
              startedCalls.add(key);
              yield { t: 'tool-start', callId: entry.callId, name: entry.name };
            }
            if (tc.function?.arguments) {
              entry.args += tc.function.arguments;
              yield { t: 'tool-args', callId: entry.callId, delta: tc.function.arguments };
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        // A PROVIDER THAT SENT NOTHING IS NOT A MODEL THAT SAID NOTHING, and this is the only layer
        // that can tell them apart. A model ending an empty turn still sends a FINISH REASON; a host
        // that never wrote a body produces a stream that completes with neither content nor a finish
        // frame (a gateway at its per-minute cap answers 200 that way). Reported as `done`, the
        // second becomes an empty MODEL turn: the loop nudges it twice, gives up politely, and the
        // panel closes the job with "nothing was said" about a turn the model was never asked —
        // a platform fault worn as the model's silence, with no retry and nothing to press.
        if (finishReason === null && !said) {
          yield { t: 'error', error: classify({ message: PROVIDER_SILENCE }) };
          return;
        }

        const final: FinalToolCall[] = [...buffers.values()].map((e) => ({
          callId: e.callId,
          name: e.name,
          args: parseArgs(e.args),
          rawArgs: e.args,
        }));

        /**
         * THE CALL THE MODEL TYPED INTO ITS MESSAGE, promoted to the channel it belongs in.
         *
         * A held body is a call only where the wire carried NO tool call of its own and the turn was
         * not truncated: a truncated body cannot be trusted to be the whole object it parses as, and
         * a turn with real calls in it has already said what it wanted through the proper channel.
         * The endpoint is remembered, so the next request to it goes unstreamed and this normalizing
         * is a first-turn repair rather than a standing translation.
         */
        const prose = buffers.size === 0 && finishReason !== 'length'
          ? toolCallInProse(holdText, toolNames)
          : undefined;
        if (prose !== undefined) {
          const callId = `call-prose-${synthCounter++}`;
          yield { t: 'tool-start', callId, name: prose.name };
          yield { t: 'tool-args', callId, delta: prose.rawArgs };
          final.push({ callId, name: prose.name, args: prose.args, rawArgs: prose.rawArgs });
          PROSE_ENDPOINTS.add(endpointKey);
        } else {
          for (const d of held) yield { t: 'text', delta: d };
        }

        yield {
          t: 'done',
          stop: prose !== undefined ? 'tool-calls' : mapStop(finishReason),
          final,
          ...(thinking.raw() ? { raw: thinking.raw() } : {}),
          ...(usage !== undefined && { usage }),
          ...(prose !== undefined && { quirks: ['tool-call-as-prose' as TurnQuirk] }),
        };
      } catch (err) {
        yield streamFailureEvent(err, signal.aborted, [opts.apiKey]);
      }
    },

    async listModels(signal: AbortSignal): Promise<string[]> {
      const ids: string[] = [];
      const rows: unknown[] = [];
      for await (const m of client.models.list({ signal })) { ids.push(m.id); rows.push(m); }
      rememberNativeModels(providerId, rows, providerId === 'custom' ? opts.baseUrl : undefined);
      return ids;
    },
  };
}
