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
import { OPENAI_BASE_URL, type ProviderId, type Quirks } from './defaults';
import type { ModelCapabilities } from '../core/adapter';
import { modelCapabilities, rememberNativeModels } from './model-catalog';
import { ChatReasoning, savedChat } from './chat-reasoning';
import { reasoningBody } from './reasoning';
import { streamFailureEvent } from './http-failure';
import type { Adapter, AdapterRequest } from '../core/adapter';

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
function toOpenAIMessages(
  system: string, messages: ProviderMessage[],
  opts: { imageInToolResult?: boolean; sameModel?: boolean; endpoint?: string } = {},
): OpenAI.ChatCompletionMessageParam[] {
  const { imageInToolResult = false, sameModel = false, endpoint } = opts;
  const out: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContent(m.text, m.images) });
    } else if (m.role === 'assistant') {
      const saved = sameModel ? savedChat(m.raw) : undefined;
      const raw = endpoint === undefined || saved?.endpoint === endpoint ? saved : undefined;
      // Never `content: null`: the spec makes content optional only beside tool_calls, and a strict
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
      // Two passes, never one interleaved loop: every tool_call_id must be answered by a
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
 * A gateway that does not know `stream_options` refuses the whole request rather than ignoring the
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

/** OpenAI's reasoning model families, which take `max_completion_tokens` and, on OpenAI's own host,
 *  the Responses protocol. */
export const OPENAI_REASONING_MODEL = /^(?:gpt-[5-9]|o[1-9])/;

/** Whether a turn goes over the Responses protocol: a reasoning model on OpenAI's own host. */
function usesResponses(baseUrl: string | undefined, model: string, caps: ModelCapabilities | undefined): boolean {
  const official = !baseUrl || baseUrl.replace(/\/$/, '') === OPENAI_BASE_URL;
  return official && (caps?.reasoning === true || OPENAI_REASONING_MODEL.test(model));
}

/** A tool call the model typed into its message body instead of the tool_calls channel. */
interface ProseCall { name: string; args: Record<string, unknown>; rawArgs: string }

/** `arguments` as an object: the wire carries it either as JSON or as a JSON string, and models
 *  emitting a call in prose use both spellings. Absent reads as no arguments, which is a legal call
 *  for a tool whose parameters are all optional. */
function proseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') return raw.trim() === '' ? {} : parseArgs(raw);
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/**
 * The tool call a message body consists of, or undefined for ordinary prose. The whole body must
 * parse as one JSON object, `name` must be a tool the request offered, and `arguments` must be an
 * object or a JSON string of one, so prose about a tool never matches.
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

/** Whether the text so far could still grow into the whole-body JSON object a prose call is: empty,
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
 * Endpoints, by base URL, that answered a streamed request with a tool call typed into the message
 * body. Later requests to them go unstreamed, where such gateways send a proper `tool_calls` array.
 * Module-scoped because the runner builds a fresh adapter per job; kept for the page's lifetime.
 */
const PROSE_ENDPOINTS = new Set<string>();

/** Restores a fresh page's state: every endpoint streams again. */
export function __resetProseEndpoints(): void {
  PROSE_ENDPOINTS.clear();
}

/** What the wire said once a turn is over, whichever path carried it. */
interface TurnEnd {
  final: FinalToolCall[];
  /** The message body, the candidate for a tool call typed as prose. */
  text: string;
  finishReason: OpenAI.ChatCompletionChunk.Choice['finish_reason'];
  usage: Usage | undefined;
  thinking: ChatReasoning;
}

/** One streamed turn's tool-call fragments, joined into whole calls. */
class CallJoiner {
  private readonly buffers = new Map<string, CallBuffer>();
  private readonly started = new Set<string>();
  private keyless = 0;

  constructor(private readonly mintId: (index: number | undefined) => string) {}

  get size(): number { return this.buffers.size; }

  /**
   * A fragment's events. The chunk `index` is the fragment handle on the standard wire, so
   * interleaved calls accumulate apart. Some vLLM-style gateways send each call whole in one chunk
   * with no index, so the key falls back to the call id, then to a fresh key per fragment. A
   * gateway may repeat the name on a later fragment, so `tool-start` is sent once per key.
   */
  *add(tc: StreamedCall, thinking: ChatReasoning): Generator<StreamEvent> {
    const key = tc.index !== undefined ? `i${tc.index}` : tc.id !== undefined ? `d${tc.id}` : `k${this.keyless++}`;
    let entry = this.buffers.get(key);
    if (!entry) {
      entry = { callId: tc.id ?? this.mintId(tc.index), name: '', args: '' };
      this.buffers.set(key, entry);
    }
    thinking.tool(entry.callId, tc.extra_content);
    if (tc.function?.name && !this.started.has(key)) {
      entry.name = tc.function.name;
      this.started.add(key);
      yield { t: 'tool-start', callId: entry.callId, name: entry.name };
    }
    if (tc.function?.arguments) {
      entry.args += tc.function.arguments;
      yield { t: 'tool-args', callId: entry.callId, delta: tc.function.arguments };
    }
  }

  calls(): FinalToolCall[] {
    return [...this.buffers.values()].map((e) => ({ callId: e.callId, name: e.name, args: parseArgs(e.args), rawArgs: e.args }));
  }
}

type StreamedCall = { index?: number; id?: string; extra_content?: unknown; function?: { name?: string; arguments?: string } };

/**
 * Brace-opened message text, held while it could still be a whole-body tool call. A body that is
 * not brace-opened releases on its first delta; a held one is replayed delta by delta at the end of
 * the turn unless it was the call it looked like.
 */
class ProseHold {
  private readonly held: string[] = [];
  private holding = true;
  text = '';

  *add(delta: string): Generator<StreamEvent> {
    if (!this.holding) { yield { t: 'text', delta }; return; }
    this.held.push(delta);
    this.text += delta;
    this.holding = this.text.length <= PROSE_HOLD_MAX && couldBeProseCall(this.text);
    if (!this.holding) yield* this.release();
  }

  *release(): Generator<StreamEvent> {
    for (const delta of this.held) yield { t: 'text', delta };
    this.held.length = 0;
  }
}

export function createOpenAIAdapter(opts: { apiKey: string; baseUrl?: string; providerId: ProviderId; quirks: Quirks }): Adapter {
  const { providerId } = opts;
  // Custom credentials must never reach the SDK's default cloud endpoint.
  if ((providerId === 'custom' || opts.quirks.needsBaseUrl === true) && (opts.baseUrl ?? '') === '') throw new Error(NO_ENDPOINT_ADDRESS);
  const anonymous = providerId === 'custom' && opts.apiKey === '';
  const client = new OpenAI({
    // The SDK requires a nonempty key even when Authorization is explicitly omitted.
    apiKey: anonymous ? 'no-auth' : opts.apiKey,
    // Every registered provider names its host; undefined reaches the SDK only from a direct caller.
    baseURL: opts.baseUrl,
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { ...NO_TELEMETRY_HEADERS, ...(anonymous ? { Authorization: null } : {}) },
  });
  const reasoningFields = opts.quirks.reasoningFields ?? [];
  const imageInToolResult = opts.quirks.imageInToolResult;
  const streamUsage = opts.quirks.streamUsage === true;
  // Per adapter instance, so two turns never mint the same id for their id-less tool calls.
  let synthCounter = 0;
  // An endpoint that refuses `stream_options` refuses it every turn, so the refusal is kept.
  let usageParamRefused = false;
  /** This adapter's row in `PROSE_ENDPOINTS`; the SDK's default endpoint keys on the empty string. */
  const endpointKey = opts.baseUrl ?? '';

  function requestBody(req: AdapterRequest, capabilities: ModelCapabilities | undefined): OpenAI.ChatCompletionCreateParamsNonStreaming {
    return {
      model: req.model,
      ...reasoningBody(opts.quirks.thinkingWire, req.thinking, capabilities),
      ...(req.maxOutputTokens === undefined ? {} : OPENAI_REASONING_MODEL.test(req.model)
        ? { max_completion_tokens: req.maxOutputTokens } : { max_tokens: req.maxOutputTokens }),
      messages: toOpenAIMessages(req.system, req.messages, { imageInToolResult, sameModel: req.sameModel, endpoint: endpointKey }),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })) } : {}),
    };
  }

  /** Opens the stream, dropping the usage request once if the endpoint refuses that parameter. */
  async function openStream(params: OpenAI.ChatCompletionCreateParamsStreaming, signal: AbortSignal) {
    const askUsage = streamUsage && !usageParamRefused;
    try {
      return await client.chat.completions.create(
        askUsage ? { ...params, stream_options: { include_usage: true } } : params,
        { signal },
      );
    } catch (err) {
      // Usage is a statistic and the refusal would otherwise cost the whole turn.
      if (!askUsage || signal.aborted || !refusesStreamOptions(err)) throw err;
      usageParamRefused = true;
      return client.chat.completions.create(params, { signal });
    }
  }

  /**
   * The turn's closing events on both paths. A body that is one requested tool call, on a turn with
   * no wire calls that was not truncated, becomes that call, and its endpoint is sent unstreamed from
   * then on. `released` replays held text when the body was not a call.
   */
  function* finishTurn(end: TurnEnd, toolNames: ReadonlySet<string>, released: () => Generator<StreamEvent>): Generator<StreamEvent> {
    const prose = end.final.length === 0 && end.finishReason !== 'length'
      ? toolCallInProse(end.text, toolNames)
      : undefined;
    const final = end.final.slice();
    if (prose !== undefined) {
      const callId = `call-prose-${synthCounter++}`;
      yield { t: 'tool-start', callId, name: prose.name };
      yield { t: 'tool-args', callId, delta: prose.rawArgs };
      final.push({ callId, name: prose.name, args: prose.args, rawArgs: prose.rawArgs });
      PROSE_ENDPOINTS.add(endpointKey);
    } else {
      yield* released();
    }
    yield {
      t: 'done',
      stop: prose !== undefined ? 'tool-calls' : mapStop(end.finishReason),
      final,
      ...(end.thinking.raw() ? { raw: end.thinking.raw() } : {}),
      ...(end.usage !== undefined && { usage: end.usage }),
      ...(prose !== undefined && { quirks: ['tool-call-as-prose' as TurnQuirk] }),
    };
  }

  /** One turn unstreamed, for an endpoint that cannot carry a tool call on its streaming path. */
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
    const final: FinalToolCall[] = [];
    for (const call of message.tool_calls ?? []) {
      thinking.tool(call.id, (call as unknown as Record<string, unknown>).extra_content);
      if (call.type !== 'function') continue;
      const rawArgs = call.function.arguments;
      final.push({ callId: call.id, name: call.function.name, args: parseArgs(rawArgs), rawArgs });
    }
    const text = message.content ?? '';
    const end: TurnEnd = { final, text, finishReason: choice.finish_reason, usage: res.usage ? usageOf(res.usage) : undefined, thinking };
    // A body that turns out to be a call is never published as text.
    const proseCall = final.length === 0 && choice.finish_reason !== 'length' && toolCallInProse(text, toolNames) !== undefined;
    if (!proseCall && text !== '') yield { t: 'text', delta: text };
    for (const call of final) {
      yield { t: 'tool-start', callId: call.callId, name: call.name };
      if (call.rawArgs) yield { t: 'tool-args', callId: call.callId, delta: call.rawArgs };
    }
    yield* finishTurn(end, toolNames, function* () {});
  }

  /** One turn streamed: text, reasoning and tool-call fragments as they arrive. */
  async function* streamed(
    params: OpenAI.ChatCompletionCreateParamsStreaming, toolNames: ReadonlySet<string>, signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const sdkStream = await openStream(params, signal);
    const thinking = new ChatReasoning(reasoningFields, endpointKey);
    const calls = new CallJoiner((index) => `call-${index ?? 'x'}-${synthCounter++}`);
    const hold = new ProseHold();
    let finishReason: OpenAI.ChatCompletionChunk.Choice['finish_reason'] = null;
    let usage: Usage | undefined;
    // Whether the model produced text, a thought or a tool call; a usage-only frame is not content.
    let said = false;
    for await (const chunk of sdkStream) {
      // `include_usage` delivers usage on a trailing chunk whose `choices` array is empty.
      if (chunk.usage) usage = usageOf(chunk.usage);
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta as OpenAI.ChatCompletionChunk.Choice.Delta & { [key: string]: unknown };
      if (delta.content) { said = true; yield* hold.add(delta.content); }
      for (const thought of thinking.add(delta)) { said = true; yield { t: 'reasoning', delta: thought }; }
      for (const tc of (delta.tool_calls ?? []) as StreamedCall[]) { said = true; yield* calls.add(tc, thinking); }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    // A model ending an empty turn still sends a finish reason. A stream with neither content nor a
    // finish frame is a host that never wrote a body (a gateway at its rate cap answers 200 that
    // way), reported as a provider fault rather than as the model's silence.
    if (finishReason === null && !said) {
      yield { t: 'error', error: classify({ message: PROVIDER_SILENCE }) };
      return;
    }
    yield* finishTurn({ final: calls.calls(), text: hold.text, finishReason, usage, thinking }, toolNames, () => hold.release());
  }

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      const toolNames = new Set(req.tools.map((t) => t.name));
      try {
        const capabilities = req.capabilities ?? modelCapabilities(providerId, req.model, opts.baseUrl);
        if (usesResponses(opts.baseUrl, req.model, capabilities)) {
          const { streamResponses } = await import('./openai-responses');
          yield* streamResponses(client, { ...req, capabilities }, signal, opts.apiKey);
          return;
        }
        const body = requestBody(req, capabilities);
        if (PROSE_ENDPOINTS.has(endpointKey)) yield* unstreamed(body, toolNames, signal);
        else yield* streamed({ ...body, stream: true }, toolNames, signal);
      } catch (err) {
        yield streamFailureEvent(err, signal.aborted, [opts.apiKey]);
      }
    },

    async listModels(signal: AbortSignal): Promise<string[]> {
      const ids: string[] = [];
      const rows: unknown[] = [];
      for await (const m of client.models.list({ signal })) { ids.push(m.id); rows.push(m); }
      rememberNativeModels(providerId, rows, opts.baseUrl);
      return ids;
    },
  };
}
