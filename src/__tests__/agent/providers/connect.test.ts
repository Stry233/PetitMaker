/**
 * Building an adapter from a connection: the SDK adapter is constructed on the first request from
 * the values read at build time, once per built adapter, and a connection that cannot be built
 * answers with one error event instead of throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../agent/core/types';
import type { Adapter, AdapterRequest } from '../../../agent/core/adapter';

const { built } = vi.hoisted(() => ({ built: [] as Array<{ dialect: string; opts: Record<string, unknown> }> }));

function fakeAdapter(): Adapter {
  return {
    async *stream() { yield { t: 'done', stop: 'stop' } as StreamEvent; },
    listModels: () => Promise.resolve(['m']),
  };
}

vi.mock('../../../agent/providers/openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../agent/providers/openai')>();
  return {
    ...actual,
    createOpenAIAdapter: (opts: Parameters<typeof actual.createOpenAIAdapter>[0]) => {
      built.push({ dialect: 'openai', opts: opts as unknown as Record<string, unknown> });
      return opts.baseUrl ? fakeAdapter() : actual.createOpenAIAdapter(opts);
    },
  };
});
vi.mock('../../../agent/providers/anthropic', () => ({
  createAnthropicAdapter: (opts: Record<string, unknown>) => {
    built.push({ dialect: 'anthropic', opts });
    return fakeAdapter();
  },
}));

const { buildAdapter } = await import('../../../agent/providers/connect');

const REQ: AdapterRequest = { system: '', messages: [], tools: [], model: 'm', sameModel: false };

async function collect(adapter: Adapter): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of adapter.stream(REQ, new AbortController().signal)) out.push(ev);
  return out;
}

afterEach(() => { built.length = 0; });

describe('buildAdapter', () => {
  it('constructs nothing until the first request', () => {
    buildAdapter({ providerId: 'deepseek', apiKey: 'k' });
    expect(built).toEqual([]);
  });

  it('constructs the adapter once, from the connection as it stood at build time', async () => {
    const cfg = { providerId: 'qwen' as const, apiKey: 'k1', region: 1 as const };
    const adapter = buildAdapter(cfg);
    cfg.apiKey = 'k2';
    await collect(adapter);
    await adapter.listModels(new AbortController().signal);
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({
      dialect: 'openai',
      opts: { apiKey: 'k1', providerId: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    });
  });

  it('speaks through the Anthropic adapter for the provider whose dialect it is', async () => {
    await collect(buildAdapter({ providerId: 'claude', apiKey: 'k' }));
    expect(built.map((b) => b.dialect)).toEqual(['anthropic']);
  });

  it('answers one config error for a custom connection with no address, and lists no models', async () => {
    const adapter = buildAdapter({ providerId: 'custom', apiKey: 'k' });
    const events = await collect(adapter);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ t: 'error', error: { cls: 'config' } });
    await expect(adapter.listModels(new AbortController().signal)).rejects.toThrow(/no endpoint address/i);
  });
});
