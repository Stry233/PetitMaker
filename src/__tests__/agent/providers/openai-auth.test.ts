// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUIRKS } from '../../../agent/providers/defaults';
import { createOpenAIAdapter } from '../../../agent/providers/openai';
import type { StreamEvent } from '../../../agent/core/types';

const baseUrl = 'http://localhost:1234/v1';
const request = { system: 'Hello', messages: [], tools: [], model: 'local-model', sameModel: true };

function intercept(status = 200): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const sent = new Request(input, init);
    requests.push(sent);
    if (status !== 200) return Response.json({ error: { message: 'Authentication required' } }, { status });
    if (sent.url.endsWith('/models')) return Response.json({ data: [{ id: 'local-model' }] });
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }));
  return requests;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('OpenAI-compatible authentication on the wire', () => {
  it.each(['', 'x', 'lms+opaque/token=='])('lists models and streams with the configured custom credential %j', async apiKey => {
    const sent = intercept();
    const adapter = createOpenAIAdapter({ apiKey, baseUrl, providerId: 'custom', quirks: QUIRKS.custom });
    expect(await adapter.listModels(new AbortController().signal)).toEqual(['local-model']);
    const events: StreamEvent[] = [];
    for await (const event of adapter.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toContainEqual({ t: 'text', delta: 'Hello' });
    expect(events.some(event => event.t === 'done')).toBe(true);
    expect(events.some(event => event.t === 'error')).toBe(false);
    expect(sent.map(r => r.url)).toEqual([`${baseUrl}/models`, `${baseUrl}/chat/completions`]);
    expect(sent.map(r => r.headers.get('Authorization'))).toEqual([
      apiKey ? `Bearer ${apiKey}` : null,
      apiKey ? `Bearer ${apiKey}` : null,
    ]);
  });

  it.each(['', 'lms+opaque/token=='])('reports authentication refusal without retrying or changing the credential %j', async apiKey => {
    const sent = intercept(401);
    const adapter = createOpenAIAdapter({ apiKey, baseUrl, providerId: 'custom', quirks: QUIRKS.custom });
    await expect(adapter.listModels(new AbortController().signal)).rejects.toMatchObject({ status: 401 });
    const events: StreamEvent[] = [];
    for await (const event of adapter.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ t: 'error', error: expect.objectContaining({ cls: 'auth' }) }));
    expect(sent).toHaveLength(2);
    expect(sent.map(r => r.headers.get('Authorization'))).toEqual([
      apiKey ? `Bearer ${apiKey}` : null,
      apiKey ? `Bearer ${apiKey}` : null,
    ]);
  });

  it('requires an explicit custom destination and keeps cloud authentication mandatory', () => {
    const sent = intercept();
    expect(() => createOpenAIAdapter({ apiKey: '', providerId: 'custom', quirks: QUIRKS.openai })).toThrow();
    expect(() => createOpenAIAdapter({ apiKey: '', providerId: 'openai', quirks: QUIRKS.openai })).toThrow();
    expect(sent).toEqual([]);
  });
});
