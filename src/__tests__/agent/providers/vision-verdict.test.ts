/**
 * The session's vision verdicts: an id-opaque connection whose prior promises vision is confirmed
 * once through the same adapter a job would use; a tokens-only prior and the curated platforms are
 * never probed, and a fault files nothing.
 */
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
vi.mock('../../../agent/providers/connect', async (real) => (await import('../../_support/agent/scripted-connect')).scriptedConnect(await real()));

import {
  __resetVisionVerdicts, ensureVisionVerdict, readsImages, subscribeVisionVerdicts,
} from '../../../agent/providers/vision-verdict';
import type { Adapter } from '../../../agent/core/adapter';
import type { StreamEvent } from '../../../agent/core/types';
import type { Scripted } from '../../_support/agent/scripted-connect';

function answering(events: StreamEvent[]): Adapter & { calls: number } {
  const adapter = {
    calls: 0,
    async *stream() {
      adapter.calls += 1;
      for (const ev of events) yield ev;
    },
    listModels: () => Promise.resolve([]),
  };
  return adapter;
}

/** Files a verdict for a connection whose adapter the test scripts. */
const ensureScripted = (conn: Parameters<typeof ensureVisionVerdict>[0] & Scripted) => ensureVisionVerdict(conn);

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('vision-verdict', () => {
  beforeEach(__resetVisionVerdicts);

  it.each([
    { providerId: 'custom' as const, customBaseUrl: 'http://localhost:1234/v1', calls: 1 },
    { providerId: 'custom' as const, calls: 0 },
    { providerId: 'perplexity' as const, calls: 0 },
  ])('allows an empty key only on an explicit custom endpoint %j', async ({ calls, ...connection }) => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    ensureScripted({ ...connection, apiKey: '', model: 'gpt-4o-proxy', scripted: adapter });
    await settle();
    expect(adapter.calls).toBe(calls);
  });

  it('files true when the endpoint reads the probe image, and reports it under the connection key', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    let settled = 0;
    const off = subscribeVisionVerdicts(() => { settled += 1; });
    onTestFinished(off);
    ensureScripted({ providerId: 'custom', apiKey: 'k', customBaseUrl: 'https://gw.example/v1', model: 'my-claude-gateway', scripted: adapter });
    await settle();
    expect(readsImages('custom', 'https://gw.example/v1', 'my-claude-gateway')).toBe(true);
    expect(settled).toBe(1);
  });

  it('files false when the endpoint refuses the image', async () => {
    const adapter = answering([{ t: 'error', error: { cls: 'unknown', status: 400, detail: 'no multimodal inputs' } }]);
    ensureScripted({ providerId: 'perplexity', apiKey: 'k', model: 'creator/claude-strip-proxy', scripted: adapter });
    await settle();
    expect(readsImages('perplexity', undefined, 'creator/claude-strip-proxy')).toBe(false);
  });

  it('files a built-in platform\'s verdict under one key, whatever custom endpoint was saved', async () => {
    const adapter = answering([{ t: 'error', error: { cls: 'unknown', status: 400, detail: 'no multimodal inputs' } }]);
    ensureScripted({ providerId: 'perplexity', apiKey: 'k', customBaseUrl: 'https://stale.example/v1', model: 'creator/claude-strip-proxy', scripted: adapter });
    await settle();
    expect(readsImages('perplexity', undefined, 'creator/claude-strip-proxy')).toBe(false);
  });

  it('files nothing off a fault the image cannot explain, so a blip never brands a connection blind', async () => {
    const adapter = answering([{ t: 'error', error: { cls: 'network', detail: 'host unreachable' } }]);
    let settled = 0;
    const off = subscribeVisionVerdicts(() => { settled += 1; });
    onTestFinished(off);
    ensureScripted({ providerId: 'custom', apiKey: 'k', model: 'gpt-4o-proxy', scripted: adapter });
    await settle();
    expect(readsImages('custom', undefined, 'gpt-4o-proxy')).toBe(true);
    expect(settled).toBe(0);
  });

  it('never probes a tokens-only prior: the safe reading costs no request', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    ensureScripted({ providerId: 'custom', apiKey: 'k', model: 'llama-3.1-8b', scripted: adapter });
    await settle();
    expect(adapter.calls).toBe(0);
    expect(readsImages('custom', undefined, 'llama-3.1-8b')).toBe(false);
  });

  it('never probes a curated platform, whose static answer is authoritative', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    ensureScripted({ providerId: 'claude', apiKey: 'k', model: 'claude-opus-5', scripted: adapter });
    await settle();
    expect(adapter.calls).toBe(0);
    expect(readsImages('claude', undefined, 'claude-opus-5')).toBe(true);
  });

  it('spends one probe per connection: a second ask answers from the verdict', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    const conn = { providerId: 'custom' as const, apiKey: 'k', model: 'gemini-relay', scripted: adapter };
    ensureVisionVerdict(conn);
    await settle();
    ensureVisionVerdict(conn);
    await settle();
    expect(adapter.calls).toBe(1);
  });
});
