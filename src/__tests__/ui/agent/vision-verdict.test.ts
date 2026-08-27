/**
 * The session's vision verdicts: an id-opaque connection whose PRIOR promises vision is confirmed
 * once through the same adapter a job would use; a tokens-only prior and the curated platforms are
 * never probed, and a fault files nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureVisionVerdict, forgetVisionVerdicts, knownVision, visionKey } from '../../../ui/agent/vision-verdict';
import type { Adapter } from '../../../agent/providers/types';
import type { StreamEvent } from '../../../agent/core/types';

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

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('vision-verdict', () => {
  beforeEach(forgetVisionVerdicts);

  it('files true when the endpoint reads the probe image, and reports it under the connection key', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    let settled = 0;
    ensureVisionVerdict({ providerId: 'custom', apiKey: 'k', customBaseUrl: 'https://gw.example/v1', model: 'my-claude-gateway', adapterForTest: adapter }, () => { settled += 1; });
    await settle();
    expect(knownVision(visionKey('custom', 'https://gw.example/v1', 'my-claude-gateway'))).toBe(true);
    expect(settled).toBe(1);
  });

  it('files false when the endpoint refuses the image', async () => {
    const adapter = answering([{ t: 'error', error: { cls: 'unknown', status: 400, detail: 'no multimodal inputs' } }]);
    ensureVisionVerdict({ providerId: 'perplexity', apiKey: 'k', model: 'creator/claude-strip-proxy', adapterForTest: adapter }, () => {});
    await settle();
    expect(knownVision(visionKey('perplexity', undefined, 'creator/claude-strip-proxy'))).toBe(false);
  });

  it('files nothing off a fault the image cannot explain, so a blip never brands a connection blind', async () => {
    const adapter = answering([{ t: 'error', error: { cls: 'network', detail: 'host unreachable' } }]);
    let settled = 0;
    ensureVisionVerdict({ providerId: 'custom', apiKey: 'k', model: 'gpt-4o-proxy', adapterForTest: adapter }, () => { settled += 1; });
    await settle();
    expect(knownVision(visionKey('custom', undefined, 'gpt-4o-proxy'))).toBeUndefined();
    expect(settled).toBe(0);
  });

  it('never probes a tokens-only prior: the safe reading costs no request', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    ensureVisionVerdict({ providerId: 'custom', apiKey: 'k', model: 'llama-3.1-8b', adapterForTest: adapter }, () => {});
    await settle();
    expect(adapter.calls).toBe(0);
    expect(knownVision(visionKey('custom', undefined, 'llama-3.1-8b'))).toBeUndefined();
  });

  it('never probes a curated platform, whose static answer is authoritative', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    ensureVisionVerdict({ providerId: 'claude', apiKey: 'k', model: 'claude-opus-5', adapterForTest: adapter }, () => {});
    await settle();
    expect(adapter.calls).toBe(0);
    expect(knownVision(visionKey('claude', undefined, 'claude-opus-5'))).toBeUndefined();
  });

  it('spends one probe per connection: a second ask answers from the verdict', async () => {
    const adapter = answering([{ t: 'text', delta: 'Red' }, { t: 'done', stop: 'stop' }]);
    const conn = { providerId: 'custom' as const, apiKey: 'k', model: 'gemini-relay', adapterForTest: adapter };
    ensureVisionVerdict(conn, () => {});
    await settle();
    ensureVisionVerdict(conn, () => {});
    await settle();
    expect(adapter.calls).toBe(1);
  });
});
