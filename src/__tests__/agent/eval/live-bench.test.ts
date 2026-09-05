// @vitest-environment node
/** The bench's live seam, without a network: the env triple's loud failure, key redaction, the
 *  wire shim's header/rewrite/strip/log behavior, the tools-mode probe's three answers, the
 *  vision probe's verdicts, image-payload redaction, and the request-start pacing floor. */
import { describe, expect, it } from 'vitest';
import {
  PROBE_IMAGE, createPacedAdapter, parseLiveEnv, probeToolsMode, probeVision, redactImagePayloads,
  redactKey, stripEmptyTools, wireFetch, withThinkingBudget,
} from '../../../agent/eval/live-bench';
import { createScriptedAdapter } from '../../../agent/eval/scripted-adapter';
import { sanitizeEndpointUrl } from '../../../core/runtime/endpoint-url';
import type { StreamEvent } from '../../../agent/core/types';

const KEY = 'sk-live-abcdef1234567890';

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('parseLiveEnv', () => {
  const FULL = { AGENT_LIVE_BASE_URL: 'http://gw.example/v1', AGENT_LIVE_KEY: 'none', AGENT_LIVE_MODEL: 'm' };

  it('names exactly the missing variables', () => {
    expect(() => parseLiveEnv({ AGENT_LIVE_KEY: 'k' }))
      .toThrow(/Missing: AGENT_LIVE_BASE_URL, AGENT_LIVE_MODEL\./);
  });

  it('accepts a placeholder key and defaults the dialect to openai', () => {
    const cfg = parseLiveEnv(FULL);
    expect(cfg).toEqual({ baseUrl: 'http://gw.example/v1', key: 'none', model: 'm', dialect: 'openai' });
  });

  it('parses the headers JSON and refuses anything but an object of strings', () => {
    const cfg = parseLiveEnv({ ...FULL, AGENT_LIVE_HEADERS: '{"X-Client-Name":"@me","X-Client-Env":"test"}' });
    expect(cfg.headers).toEqual({ 'X-Client-Name': '@me', 'X-Client-Env': 'test' });
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_HEADERS: '["nope"]' })).toThrow(/JSON object of string header values/);
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_HEADERS: '{"n":1}' })).toThrow(/JSON object of string header values/);
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_HEADERS: 'not json' })).toThrow(/JSON object of string header values/);
  });

  it('reads the dialect and refuses an unknown one', () => {
    expect(parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'anthropic' }).dialect).toBe('anthropic');
    expect(parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'responses' }).dialect).toBe('responses');
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'chat' })).toThrow(/"openai", "anthropic" or "responses"/);
  });

  it('reads AGENT_LIVE_THINKING as a token budget on the anthropic dialect, off when absent or empty', () => {
    expect(parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'anthropic', AGENT_LIVE_THINKING: '8192' }).thinking).toBe(8192);
    expect(parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'anthropic' }).thinking).toBeUndefined();
    expect(parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'anthropic', AGENT_LIVE_THINKING: '' }).thinking).toBeUndefined();
  });

  it('refuses a budget that is not an integer of at least 1024, the API minimum', () => {
    for (const bad of ['lots', '0', '512', '1023', '-2048', '2048.5']) {
      expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'anthropic', AGENT_LIVE_THINKING: bad }))
        .toThrow(/at least 1024/);
    }
  });

  it('refuses the budget on a dialect with no extended-thinking parameter, rather than silently ignoring it', () => {
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_THINKING: '8192' })).toThrow(/anthropic dialect/);
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'responses', AGENT_LIVE_THINKING: '8192' })).toThrow(/anthropic dialect/);
  });
});

describe('withThinkingBudget', () => {
  it('sets the enabled-budget thinking parameter and leaves a ceiling the budget clears alone', () => {
    const body = JSON.stringify({ model: 'm', max_tokens: 32000, thinking: { type: 'adaptive' }, messages: [] });
    expect(JSON.parse(withThinkingBudget(body, 8192) as string)).toEqual({
      model: 'm', max_tokens: 32000, thinking: { type: 'enabled', budget_tokens: 8192 }, messages: [],
    });
  });

  it('raises a ceiling the budget would not fit under by the original ceiling, keeping the answer its headroom', () => {
    const body = JSON.stringify({ model: 'm', max_tokens: 64, messages: [] });
    const out = JSON.parse(withThinkingBudget(body, 1024) as string) as Record<string, unknown>;
    expect(out.max_tokens).toBe(1088);
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('leaves the messages untouched, a raw assistant echo of thinking + tool_use blocks included', () => {
    const messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan the move', signature: 'sig-abc' },
          { type: 'tool_use', id: 'call_1', name: 'paint_tiles', input: { a: 1 } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'done' }] },
    ];
    const out = JSON.parse(withThinkingBudget(JSON.stringify({ model: 'm', max_tokens: 32000, messages }), 2048) as string) as Record<string, unknown>;
    expect(out.messages).toEqual(messages);
  });

  it('passes non-JSON, non-string, and non-Messages bodies through untouched', () => {
    expect(withThinkingBudget('plain', 2048)).toBe('plain');
    expect(withThinkingBudget(undefined, 2048)).toBeUndefined();
    const modelsBody = JSON.stringify({ model: 'm' });
    expect(withThinkingBudget(modelsBody, 2048)).toBe(modelsBody);
  });
});

describe('redactKey', () => {
  it('reduces every occurrence to first4…last3', () => {
    const text = `Authorization: Bearer ${KEY} and again ${KEY}.`;
    expect(redactKey(text, KEY)).toBe('Authorization: Bearer sk-l…890 and again sk-l…890.');
  });

  it('replaces a short key whole, since head plus tail would be most of it', () => {
    expect(redactKey('key=none', 'none')).toBe('key=<redacted-key>');
  });

  it('leaves text alone for an empty key', () => {
    expect(redactKey('nothing here', '')).toBe('nothing here');
  });
});

describe('stripEmptyTools', () => {
  it('drops an empty tools array and its tool_choice', () => {
    const body = JSON.stringify({ model: 'm', tools: [], tool_choice: 'auto', messages: [] });
    expect(JSON.parse(stripEmptyTools(body) as string)).toEqual({ model: 'm', messages: [] });
  });

  it('leaves a populated tools array, non-JSON, and non-string bodies untouched', () => {
    const body = JSON.stringify({ tools: [{ name: 't' }] });
    expect(stripEmptyTools(body)).toBe(body);
    expect(stripEmptyTools('plain')).toBe('plain');
    expect(stripEmptyTools(undefined)).toBeUndefined();
  });
});

describe('wireFetch', () => {
  function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
        c.close();
      },
    });
  }

  it('injects and drops headers, rewrites the pinned host, strips empty tools, and logs it all redacted', async () => {
    const lines: string[] = [];
    let captured: { url: string; init?: RequestInit } | undefined;
    const fake: typeof fetch = async (url, init) => {
      captured = { url: String(url), ...(init !== undefined ? { init } : {}) };
      return new Response(sseBody(['data: one\n\n', 'data: two\n\n']), { status: 200 });
    };
    const f = wireFetch(fake, {
      headers: { 'X-Client-Name': '@me', Authorization: `Bearer ${KEY}` },
      dropHeaders: ['x-api-key'],
      rewriteBase: { from: 'https://api.anthropic.com', to: 'https://proxy.example/anthropic' },
      redact: (s) => redactKey(s, KEY),
      sink: (l) => lines.push(l),
      now: () => 7,
    });

    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY },
      body: JSON.stringify({ model: 'm', tools: [], messages: [] }),
    });
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n');
    // The log branch settles after the passthrough branch was consumed.
    await new Promise((r) => setTimeout(r, 10));

    expect(captured?.url).toBe('https://proxy.example/anthropic/v1/messages');
    const sentHeaders = new Headers(captured?.init?.headers);
    expect(sentHeaders.get('X-Client-Name')).toBe('@me');
    expect(sentHeaders.get('x-api-key')).toBeNull();
    expect(captured?.init?.body).toBe(JSON.stringify({ model: 'm', messages: [] }));

    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.map((r) => r.t)).toEqual(['request', 'response', 'chunk', 'chunk', 'response-end']);
    const request = records[0]!;
    expect(request.url).toBe('https://proxy.example/anthropic/v1/messages');
    expect(request.at).toBe(7);
    expect(request.body).toBe(JSON.stringify({ model: 'm', messages: [] }));
    expect(JSON.stringify(request)).not.toContain(KEY);
    expect((request.headers as Record<string, string>).authorization).toBe('Bearer sk-l…890');
    expect(records[1]).toMatchObject({ t: 'response', status: 200 });
    expect(records[2]).toMatchObject({ t: 'chunk', body: 'data: one\n\n' });
  });

  it('applies the body transform after the empty-tools strip, so the wire and the log carry the transformed body', async () => {
    const lines: string[] = [];
    let sentBody: unknown;
    const fake: typeof fetch = async (_url, init) => {
      sentBody = init?.body;
      return new Response(null, { status: 200 });
    };
    const f = wireFetch(fake, {
      transformBody: (b) => withThinkingBudget(b, 4096),
      redact: (s) => s,
      sink: (l) => lines.push(l),
    });
    await f('https://proxy.example/anthropic/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', max_tokens: 32000, thinking: { type: 'adaptive' }, tools: [], messages: [] }),
    });
    const expected = JSON.stringify({ model: 'm', max_tokens: 32000, thinking: { type: 'enabled', budget_tokens: 4096 }, messages: [] });
    expect(sentBody).toBe(expected);
    const request = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(request.body).toBe(expected);
  });

  it('sends the body untouched when no transform is wired, which is the thinking-off shape', async () => {
    let sentBody: unknown;
    const fake: typeof fetch = async (_url, init) => {
      sentBody = init?.body;
      return new Response(null, { status: 200 });
    };
    const f = wireFetch(fake, { redact: (s) => s, sink: () => {} });
    const body = JSON.stringify({ model: 'm', max_tokens: 32000, thinking: { type: 'adaptive' }, messages: [] });
    await f('https://proxy.example/anthropic/v1/messages', { method: 'POST', body });
    expect(sentBody).toBe(body);
  });

  it('records a thrown fetch as a wire-error line and rethrows it', async () => {
    const lines: string[] = [];
    const fake: typeof fetch = async () => { throw new Error(`getaddrinfo ENOTFOUND gw with ${KEY}`); };
    const f = wireFetch(fake, { redact: (s) => redactKey(s, KEY), sink: (l) => lines.push(l) });
    await expect(f('http://gw/v1/models')).rejects.toThrow(/ENOTFOUND/);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.map((r) => r.t)).toEqual(['request', 'wire-error']);
    expect(records[1]!.message).toContain('sk-l…890');
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('closes the record for a bodyless response', async () => {
    const lines: string[] = [];
    const fake: typeof fetch = async () => new Response(null, { status: 204 });
    const f = wireFetch(fake, { redact: (s) => s, sink: (l) => lines.push(l) });
    const res = await f('http://gw/v1/x', { method: 'POST' });
    expect(res.status).toBe(204);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.map((r) => r.t)).toEqual(['request', 'response', 'response-end']);
  });
});

describe('probeToolsMode', () => {
  it('sends the tools parameter and reads an accepted answer as native mode', async () => {
    const adapter = createScriptedAdapter([{ events: [{ t: 'text', delta: 'ok' }, { t: 'done', stop: 'stop' }] }]);
    const probe = await probeToolsMode(adapter, 'm');
    expect(probe.mode).toBe('native');
    expect(probe.detail).toContain('tools accepted');
    expect(adapter.requests[0]!.tools.length).toBe(1);
    expect(adapter.requests[0]!.model).toBe('m');
  });

  it('reads a tools-unsupported 400 as prose mode', async () => {
    const adapter = createScriptedAdapter([
      { error: { cls: 'unknown', detail: 'Tool calling is not supported for this model.', status: 400 } },
    ]);
    const probe = await probeToolsMode(adapter, 'sonar');
    expect(probe.mode).toBe('prose');
    expect(probe.detail).toBe('tools refused (400): Tool calling is not supported for this model.');
  });

  it('throws on any other failure, naming the class and status', async () => {
    const adapter = createScriptedAdapter([{ error: { cls: 'auth', detail: 'invalid token', status: 401 } }]);
    await expect(probeToolsMode(adapter, 'm')).rejects.toThrow(/probe failed \(auth 401\): invalid token/);
  });

  it('adds the VPN hint when the host never resolved', async () => {
    const adapter = createScriptedAdapter([
      { error: { cls: 'network', detail: 'getaddrinfo ENOTFOUND training-gw.pplx.net' } },
    ]);
    await expect(probeToolsMode(adapter, 'm')).rejects.toThrow(/VPN link is down/);
  });
});

describe('probeVision', () => {
  it('sends the tiny image part with no tools and reads the named color as a vision seat', async () => {
    const adapter = createScriptedAdapter([{ events: [{ t: 'text', delta: 'Red' }, { t: 'text', delta: '.' }, { t: 'done', stop: 'stop' }] }]);
    const probe = await probeVision(adapter, 'm');
    expect(probe.vision).toBe(true);
    expect(probe.detail).toBe('image read (answered "Red.")');
    const req = adapter.requests[0]!;
    expect(req.tools).toEqual([]);
    expect(req.model).toBe('m');
    expect(req.messages).toHaveLength(1);
    const first = req.messages[0]!;
    expect(first.role === 'user' && first.images).toEqual([PROBE_IMAGE]);
    expect(PROBE_IMAGE.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('reads an answer that never names the color as an ignored image, so a silently-dropping gateway counts text-only', async () => {
    const adapter = createScriptedAdapter([{ events: [{ t: 'text', delta: 'ok' }, { t: 'done', stop: 'stop' }] }]);
    const probe = await probeVision(adapter, 'm');
    expect(probe.vision).toBe(false);
    expect(probe.detail).toBe('image ignored (answered "ok")');
  });

  it('reads a client-error refusal as text-only, carrying the endpoint\'s own words', async () => {
    const adapter = createScriptedAdapter([
      { error: { cls: 'unknown', detail: 'Invalid content type. image_url is only supported by certain models.', status: 400 } },
    ]);
    const probe = await probeVision(adapter, 'm');
    expect(probe.vision).toBe(false);
    expect(probe.detail).toBe('image refused (400): Invalid content type. image_url is only supported by certain models.');
  });

  it('throws on a failure that is not about the image (auth, rate, network), naming class and status', async () => {
    const auth = createScriptedAdapter([{ error: { cls: 'auth', detail: 'invalid token', status: 401 } }]);
    await expect(probeVision(auth, 'm')).rejects.toThrow(/vision probe failed \(auth 401\): invalid token/);
    const net = createScriptedAdapter([{ error: { cls: 'network', detail: 'fetch failed' } }]);
    await expect(probeVision(net, 'm')).rejects.toThrow(/vision probe failed \(network\)/);
  });
});

describe('redactImagePayloads', () => {
  const B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGP8z0AaYCJRPcOoBmIAE1GqkMCoBmIAyRoAQC4BH1m1rqAAAAAASUVORK5CYII=';

  it('reduces an image data URL payload to a size + hash stamp and keeps the line valid JSON', () => {
    const line = JSON.stringify({ t: 'request', body: JSON.stringify({ url: `data:image/png;base64,${B64}` }) });
    const out = redactImagePayloads(line);
    expect(out).not.toContain(B64);
    expect(out).toMatch(/data:image\/png;base64,<image ~\d+B fnv1a:[0-9a-f]{8}>/);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('reduces an Anthropic base64 image source block, tolerating the wire log\'s escaped quotes', () => {
    const body = JSON.stringify({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64 } });
    const line = JSON.stringify({ t: 'request', body });
    const out = redactImagePayloads(line);
    expect(out).not.toContain(B64);
    expect(out).toContain('<image ~');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('stamps the same payload identically, so two shots can be told apart or matched by hash', () => {
    const a = redactImagePayloads(`data:image/png;base64,${B64}`);
    const b = redactImagePayloads(`data:image/png;base64,${B64}`);
    expect(a).toBe(b);
    const other = redactImagePayloads(`data:image/png;base64,${B64.slice(0, -8)}AAAAAAA=`);
    expect(other).not.toBe(a);
  });

  it('leaves short base64 and non-image data fields alone', () => {
    const line = JSON.stringify({ body: JSON.stringify({ data: 'aGVsbG8gd29ybGQ=', note: 'data:image/png;base64,QUJD' }) });
    expect(redactImagePayloads(line)).toBe(line);
  });
});

describe('createPacedAdapter', () => {
  it('spends the floor between request starts and nothing before the first', async () => {
    let t = 0;
    const waits: number[] = [];
    const inner = createScriptedAdapter([
      { events: [{ t: 'done', stop: 'stop' }] },
      { events: [{ t: 'done', stop: 'stop' }] },
    ]);
    const paced = createPacedAdapter(inner, 1000, {
      now: () => t,
      sleep: async (ms) => { waits.push(ms); t += ms; },
    });
    await collect(paced.stream({ system: '', messages: [], tools: [], model: 'm', sameModel: false }, new AbortController().signal));
    await collect(paced.stream({ system: '', messages: [], tools: [], model: 'm', sameModel: false }, new AbortController().signal));
    expect(waits).toEqual([1000]);
  });

  it('ends the turn as aborted when the wait is cut short', async () => {
    const inner = createScriptedAdapter([
      { events: [{ t: 'done', stop: 'stop' }] },
      { events: [{ t: 'done', stop: 'stop' }] },
    ]);
    const paced = createPacedAdapter(inner, 1000, {
      now: () => 0,
      sleep: () => Promise.reject(new Error('aborted')),
    });
    const req = { system: '', messages: [], tools: [], model: 'm', sameModel: false };
    await collect(paced.stream(req, new AbortController().signal));
    const events = await collect(paced.stream(req, new AbortController().signal));
    expect(events).toEqual([{ t: 'done', stop: 'aborted' }]);
  });
});

describe('the product path beside this seam', () => {
  it('still forces https for a non-loopback http endpoint, so only the bench can reach one', () => {
    expect(sanitizeEndpointUrl('http://training-uw-1-eks-ivy.pplx.net/v1'))
      .toBe('https://training-uw-1-eks-ivy.pplx.net/v1');
    expect(sanitizeEndpointUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
  });
});
