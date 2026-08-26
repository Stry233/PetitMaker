import { describe, expect, it } from 'vitest';
import type { StreamEvent, TurnError } from '../../../agent/core/types';
import type { AdapterRequest } from '../../../agent/providers/types';
import { createScriptedAdapter } from '../../../agent/eval/scripted-adapter';

function baseRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    system: 'You are an agent.',
    messages: [],
    tools: [],
    model: 'scripted-model',
    sameModel: true,
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('eval/scripted-adapter', () => {
  it('plays turns in order and records each request', async () => {
    const t1: StreamEvent[] = [{ t: 'text', delta: 'hi' }, { t: 'done', stop: 'stop' }];
    const t2: StreamEvent[] = [{ t: 'text', delta: 'bye' }, { t: 'done', stop: 'stop' }];
    const adapter = createScriptedAdapter([{ events: t1 }, { events: t2 }]);

    const r1 = baseRequest({ model: 'a' });
    const out1 = await collect(adapter.stream(r1, new AbortController().signal));
    expect(out1).toEqual(t1);

    const r2 = baseRequest({ model: 'b' });
    const out2 = await collect(adapter.stream(r2, new AbortController().signal));
    expect(out2).toEqual(t2);

    expect(adapter.requests).toEqual([r1, r2]);
  });

  it('computes events from the request for a function turn', async () => {
    const adapter = createScriptedAdapter([
      (req: AdapterRequest) => [{ t: 'text', delta: req.model }, { t: 'done', stop: 'stop' }],
    ]);
    const req = baseRequest({ model: 'echoed' });
    const out = await collect(adapter.stream(req, new AbortController().signal));
    expect(out).toEqual([{ t: 'text', delta: 'echoed' }, { t: 'done', stop: 'stop' }]);
  });

  it('yields the exhausted sentinel once the script runs out', async () => {
    const adapter = createScriptedAdapter([{ events: [{ t: 'done', stop: 'stop' }] }]);
    await collect(adapter.stream(baseRequest(), new AbortController().signal));
    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'text', delta: '(script exhausted)' }, { t: 'done', stop: 'stop' }]);
  });

  it('emits exactly one error event for an { error } turn', async () => {
    const error: TurnError = { cls: 'overloaded', detail: 'busy' };
    const adapter = createScriptedAdapter([{ error }]);
    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'error', error }]);
  });

  it('resolves listModels to the one scripted model', async () => {
    const adapter = createScriptedAdapter([]);
    await expect(adapter.listModels(new AbortController().signal)).resolves.toEqual(['scripted-model']);
  });

  it('stops yielding once the signal aborts and ends with done/aborted', async () => {
    const events: StreamEvent[] = [
      { t: 'text', delta: 'a' },
      { t: 'text', delta: 'b' },
      { t: 'text', delta: 'c' },
      { t: 'done', stop: 'stop' },
    ];
    const adapter = createScriptedAdapter([{ events }]);
    const controller = new AbortController();
    const gen = adapter.stream(baseRequest(), controller.signal);

    const out: StreamEvent[] = [];
    const first = await gen.next();
    out.push(first.value as StreamEvent);
    controller.abort();
    for await (const e of gen) out.push(e);

    expect(out).toEqual([
      { t: 'text', delta: 'a' },
      { t: 'done', stop: 'aborted' },
    ]);
  });
});
