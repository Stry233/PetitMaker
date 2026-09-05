/**
 * Web-only support for live evaluation: parse the `AGENT_LIVE_*` configuration, redact credentials
 * and image bodies, inject or remove gateway headers, rewrite SDK hosts, record a JSONL wire trace,
 * probe native tools and vision, and pace request starts. The caller owns filesystem output. Unlike
 * product endpoint settings, this developer harness permits an explicit HTTP base URL.
 */
import type { StreamEvent, TurnError } from '../core/types';
import type { Adapter, AdapterRequest } from '../providers/types';

export interface LiveEnv {
  baseUrl: string; key: string; model: string; dialect: 'openai' | 'anthropic' | 'responses'; headers?: Record<string, string>;
  /** Extended-thinking token budget for the anthropic dialect (`AGENT_LIVE_THINKING`); absent is off. */
  thinking?: number;
}

const LIVE_VARS = ['AGENT_LIVE_BASE_URL', 'AGENT_LIVE_KEY', 'AGENT_LIVE_MODEL'] as const;

export function parseLiveEnv(env: Record<string, string | undefined>): LiveEnv {
  const missing = LIVE_VARS.filter((v) => !env[v]);
  if (missing.length > 0) {
    throw new Error(
      `--live needs ${LIVE_VARS.join(', ')} (any OpenAI-compatible gateway; the key may be a `
      + `placeholder like "none" for a header-authed one). Missing: ${missing.join(', ')}.`,
    );
  }
  const dialect = env.AGENT_LIVE_DIALECT ?? 'openai';
  if (dialect !== 'openai' && dialect !== 'anthropic' && dialect !== 'responses') {
    throw new Error(`AGENT_LIVE_DIALECT must be "openai", "anthropic" or "responses", not "${dialect}".`);
  }
  const out: LiveEnv = {
    baseUrl: env.AGENT_LIVE_BASE_URL!, key: env.AGENT_LIVE_KEY!, model: env.AGENT_LIVE_MODEL!, dialect,
  };
  const rawHeaders = env.AGENT_LIVE_HEADERS;
  if (rawHeaders !== undefined && rawHeaders !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(rawHeaders); } catch { parsed = undefined; }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
      || !Object.values(parsed).every((v) => typeof v === 'string')) {
      throw new Error('AGENT_LIVE_HEADERS must be a JSON object of string header values, e.g. {"X-Client-Name":"@me"}.');
    }
    out.headers = parsed as Record<string, string>;
  }
  const rawThinking = env.AGENT_LIVE_THINKING;
  if (rawThinking !== undefined && rawThinking !== '') {
    const budget = Number(rawThinking);
    if (!Number.isInteger(budget) || budget < 1024) {
      throw new Error(`AGENT_LIVE_THINKING must be an integer budget of at least 1024 thinking tokens (the API minimum), not "${rawThinking}".`);
    }
    if (out.dialect !== 'anthropic') {
      throw new Error(`AGENT_LIVE_THINKING drives the anthropic dialect's extended-thinking parameter and does nothing on "${out.dialect}"; unset it or set AGENT_LIVE_DIALECT=anthropic.`);
    }
    out.thinking = budget;
  }
  return out;
}

/** Every occurrence of the key replaced with `first4…last3`; a key too short to keep a head and a
 *  tail of is replaced whole. */
export function redactKey(text: string, key: string): string {
  if (key === '') return text;
  const stamp = key.length >= 8 ? `${key.slice(0, 4)}…${key.slice(-3)}` : '<redacted-key>';
  return text.split(key).join(stamp);
}

export interface WireFetchOpts {
  headers?: Record<string, string>;
  /** Header names removed after injection (an SDK-minted credential header a proxy must not see). */
  dropHeaders?: string[];
  /** A pinned SDK default host mapped onto the gateway: a URL starting with `from` continues at
   *  `to` instead, path and query kept. The log records the URL actually fetched. */
  rewriteBase?: { from: string; to: string };
  /** Applied to the JSON body after the empty-tools strip; what it returns is what goes out and
   *  what the log records. */
  transformBody?: (body: unknown) => unknown;
  redact: (s: string) => string;
  sink: (line: string) => void;
  now?: () => number;
}

type Fetch = typeof globalThis.fetch;

/** A JSON body's empty `tools` array (and the `tool_choice` that only makes sense beside one)
 *  removed; any other body passes through untouched. */
export function stripEmptyTools(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return body; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
  const rec = parsed as Record<string, unknown>;
  if (!Array.isArray(rec.tools) || rec.tools.length > 0) return body;
  delete rec.tools;
  delete rec.tool_choice;
  return JSON.stringify(rec);
}

/** A Messages API JSON body's `thinking` parameter replaced with the enabled budget —
 *  `{type: 'enabled', budget_tokens}` is the installed SDK's extended-thinking shape, and the
 *  wire is the only seam this rig has into a request the adapter has already built. The API
 *  requires 1024 <= budget_tokens < max_tokens and the two share the ceiling, so a ceiling the
 *  budget would not fit under is raised BY the original ceiling: the answer keeps the headroom it
 *  had and the thinking rides on top. Messages (raw thinking/tool_use echoes included) are never
 *  touched, and anything that is not a JSON object body carrying `messages` passes through. */
export function withThinkingBudget(body: unknown, budgetTokens: number): unknown {
  if (typeof body !== 'string') return body;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return body; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
  const rec = parsed as Record<string, unknown>;
  if (!Array.isArray(rec.messages)) return body;
  rec.thinking = { type: 'enabled', budget_tokens: budgetTokens };
  if (typeof rec.max_tokens === 'number' && rec.max_tokens <= budgetTokens) {
    rec.max_tokens = budgetTokens + rec.max_tokens;
  }
  return JSON.stringify(rec);
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => { out[k] = v; });
  return out;
}

export function wireFetch(realFetch: Fetch, opts: WireFetchOpts): Fetch {
  const now = opts.now ?? Date.now;
  let nextId = 0;
  const log = (record: Record<string, unknown>): void => {
    opts.sink(opts.redact(JSON.stringify(record)));
  };

  async function logChunks(stream: ReadableStream<Uint8Array>, id: number): Promise<void> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        log({ t: 'chunk', id, at: now(), body: decoder.decode(value, { stream: true }) });
      }
    } catch {
      // The paired branch's consumer cancelled the response; nothing further to record.
    }
    log({ t: 'response-end', id, at: now() });
  }

  return async (input, init) => {
    const id = ++nextId;
    const asked = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = opts.rewriteBase !== undefined && asked.startsWith(opts.rewriteBase.from)
      ? opts.rewriteBase.to + asked.slice(opts.rewriteBase.from.length)
      : asked;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers);
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);
    for (const k of opts.dropHeaders ?? []) headers.delete(k);
    const stripped = stripEmptyTools(init?.body);
    const body = (opts.transformBody !== undefined ? opts.transformBody(stripped) : stripped) as RequestInit['body'];
    log({
      t: 'request', id, at: now(), method, url, headers: headerRecord(headers),
      body: typeof body === 'string' ? body : null,
    });

    let res: Response;
    try {
      res = await realFetch(url, { ...init, headers, body });
    } catch (err) {
      log({ t: 'wire-error', id, at: now(), message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    log({ t: 'response', id, at: now(), status: res.status });
    if (!res.body) {
      log({ t: 'response-end', id, at: now() });
      return res;
    }
    const [logged, passed] = res.body.tee();
    void logChunks(logged, id);
    return new Response(passed, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export interface ToolsModeProbe { mode: 'native' | 'prose'; detail: string }

/** Tiny and harmless on purpose: the probe measures whether the PARAMETER is accepted, not
 *  whether any real tool works. */
const PROBE_TOOL = {
  name: 'probe_echo',
  description: 'Echoes the given text back. Exists only to test whether this endpoint accepts the tools parameter.',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

/** The refusal that means "no tool calling here", not "this request is otherwise broken": the
 *  complaint must be about tools AND about support (Perplexity's regular API answers 400 "Tool
 *  calling is not supported for this model"), on a client-error status or none at all (a gateway
 *  can word the same refusal into a 200-shaped error body that carries no status). */
function refusesTools(err: TurnError): boolean {
  if (err.status !== undefined && ![400, 404, 422].includes(err.status)) return false;
  return /tool/i.test(err.detail)
    && /not (?:currently )?supported|unsupported|not allowed|does not support/i.test(err.detail);
}

const HOST_UNRESOLVED = /enotfound|eai_again|getaddrinfo|nxdomain|name or service not known/i;

export async function probeToolsMode(
  adapter: Adapter, model: string, signal: AbortSignal = new AbortController().signal,
): Promise<ToolsModeProbe> {
  const req: AdapterRequest = {
    system: 'You are a connectivity probe. Answer in one word.',
    messages: [{ role: 'user', text: 'Say ok. Do not call any tool.' }],
    tools: [PROBE_TOOL],
    model,
    sameModel: false,
    maxOutputTokens: 64,
  };
  for await (const ev of adapter.stream(req, signal)) {
    if (ev.t === 'error') {
      const first = ev.error.detail.split('\n')[0] ?? '';
      if (refusesTools(ev.error)) {
        return { mode: 'prose', detail: `tools refused (${ev.error.status ?? ev.error.cls}): ${first}` };
      }
      const vpnHint = ev.error.cls === 'network' || HOST_UNRESOLVED.test(ev.error.detail)
        ? ' If the gateway lives behind a VPN (a tailnet host), an unreachable or unresolvable host usually means the VPN link is down, not a bench bug.'
        : '';
      throw new Error(
        `tools-mode probe failed (${ev.error.cls}${ev.error.status !== undefined ? ` ${ev.error.status}` : ''}): ${first}.${vpnHint}`,
      );
    }
    if (ev.t === 'done') {
      if (ev.stop === 'aborted') throw new Error('tools-mode probe aborted before the endpoint answered.');
      const called = (ev.final ?? []).length > 0;
      // Any completed answer counts, a truncated one included: the parameter was not refused.
      return { mode: 'native', detail: `tools accepted (stop=${ev.stop}${called ? ', answered with a tool call' : ''})` };
    }
  }
  throw new Error('tools-mode probe ended without a final event.');
}

// The vision probe lives with the providers (the app's own capability check reads it there); the
// bench keeps importing it from here beside its sibling probes.
export { probeVision, PROBE_IMAGE, type VisionProbe } from '../providers/vision-probe';

/** FNV-1a 32-bit over the payload text, hex — a correlation stamp for telling shots apart, not a
 *  security measure (the key redaction above is the security one). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function imageStamp(payload: string): string {
  return `<image ~${Math.round((payload.length * 3) / 4)}B fnv1a:${fnv1a(payload)}>`;
}

/** OpenAI dialect: the data URL's payload. 40+ chars so a stamp is never itself restamped. */
const DATA_URL_PAYLOAD = /(data:image\/[\w.+-]+;base64,)([A-Za-z0-9+/=]{40,})/g;
/** Anthropic dialect: the `data` field beside an image `media_type`, quotes optionally escaped
 *  because the wire log holds the request body as a JSON string inside a JSON line. */
const SOURCE_BLOCK_PAYLOAD = /(\\?"media_type\\?":\s*\\?"image\/[\w.+-]+\\?",\s*\\?"data\\?":\s*\\?")([A-Za-z0-9+/=]{40,})(\\?")/g;

export function redactImagePayloads(line: string): string {
  return line
    .replace(DATA_URL_PAYLOAD, (_m, prefix: string, payload: string) => `${prefix}${imageStamp(payload)}`)
    .replace(SOURCE_BLOCK_PAYLOAD, (_m, prefix: string, payload: string, close: string) => `${prefix}${imageStamp(payload)}${close}`);
}

function pacedSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(new Error('aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A floor between request STARTS, spent before each `stream()` call. The reactive half of pacing
 *  (back off once an endpoint has refused) is the loop's own and is not rebuilt here. */
export function createPacedAdapter(
  inner: Adapter, floorMs: number,
  deps?: { now?: () => number; sleep?: (ms: number, signal: AbortSignal) => Promise<void> },
): Adapter {
  const now = deps?.now ?? Date.now;
  const sleep = deps?.sleep ?? pacedSleep;
  let nextAt = 0;

  return {
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      const wait = nextAt - now();
      if (wait > 0) {
        try {
          await sleep(wait, signal);
        } catch {
          yield { t: 'done', stop: 'aborted' };
          return;
        }
      }
      nextAt = now() + floorMs;
      yield* inner.stream(req, signal);
    },
    listModels(signal: AbortSignal): Promise<string[]> {
      return inner.listModels(signal);
    },
  };
}
