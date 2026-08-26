import { describe, expect, it } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:os is untyped here (no @types/node)
import { tmpdir } from 'node:os';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';
import type { StreamEvent } from '../../../agent/core/types';
import type { AdapterRequest } from '../../../agent/providers/types';
import { createPlayedAdapter } from '../../../agent/eval/played-adapter';
import type { PlayedResponse } from '../../../agent/eval/played-adapter';

function baseRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    system: 'You are an agent.',
    messages: [{ role: 'user', text: 'build a house' }],
    tools: [{ name: 'place_object', description: 'place one', parameters: {} }],
    model: 'played-model',
    sameModel: true,
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'played-adapter-'));
}

/** Writes the response file after one tick, so the poll loop must actually poll rather than
 *  finding the file present on its very first check. */
function respondSoon(dir: string, n: number, response: PlayedResponse): void {
  setTimeout(() => {
    writeFileSync(join(dir, `turn-${n}.response.json`), JSON.stringify(response));
  }, 10);
}

describe('eval/played-adapter', () => {
  it('writes the derived request and reads it back verbatim', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });
    const req = baseRequest();
    respondSoon(dir, 1, { text: 'ok', stop: 'stop' });

    await collect(adapter.stream(req, new AbortController().signal));

    const written = JSON.parse(readFileSync(join(dir, 'turn-1.request.json'), 'utf8'));
    expect(written).toEqual({ system: req.system, messages: req.messages, tools: req.tools, model: req.model });
  });

  it('converts a text + one-call response into the right event sequence', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });
    respondSoon(dir, 1, {
      text: 'placing it now',
      toolCalls: [{ name: 'place_object', args: { x: 1, y: 2 } }],
    });

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(out).toEqual([
      { t: 'text', delta: 'placing it now' },
      { t: 'tool-start', callId: 'p1-0', name: 'place_object' },
      { t: 'tool-args', callId: 'p1-0', delta: JSON.stringify({ x: 1, y: 2 }) },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [{ callId: 'p1-0', name: 'place_object', args: { x: 1, y: 2 }, rawArgs: JSON.stringify({ x: 1, y: 2 }) }],
      },
    ]);
  });

  it('defaults stop to "stop" when the response carries no calls', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });
    respondSoon(dir, 1, { text: 'done talking' });

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'text', delta: 'done talking' }, { t: 'done', stop: 'stop', final: [] }]);
  });

  it('converts a response.error into one error event, ignoring text/toolCalls when both are set', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });
    respondSoon(dir, 1, {
      text: 'this should never surface',
      toolCalls: [{ name: 'place_object', args: { x: 1, y: 2 } }],
      error: { cls: 'auth', detail: 'scripted key rejection' },
    });

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'error', error: { cls: 'auth', detail: 'scripted key rejection' } }]);
  });

  it('defaults the error detail when the fixture omits one', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });
    respondSoon(dir, 1, { error: { cls: 'rate-limit' } });

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'error', error: { cls: 'rate-limit', detail: 'played response scripted a failure' } }]);
  });

  it('emits a network error after the timeout with no response file', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { timeoutMs: 20, pollMs: 5 });

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'error', error: { cls: 'network', detail: 'played model did not answer' } }]);
  });

  it('stops polling and ends with done/aborted when the signal aborts', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { timeoutMs: 5000, pollMs: 5 });
    const controller = new AbortController();

    const promise = collect(adapter.stream(baseRequest(), controller.signal));
    setTimeout(() => controller.abort(), 15);
    const out = await promise;

    expect(out).toEqual([{ t: 'done', stop: 'aborted' }]);
  });

  it('treats a half-written response file as not-ready and picks it up once complete', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });
    const path = join(dir, 'turn-1.response.json');
    const full = JSON.stringify({ text: 'placing it now', toolCalls: [{ name: 'place_object', args: { x: 1 } }] });

    // A non-atomic write: half the JSON lands first (a torn read here must not throw), and the
    // rest follows a tick later.
    writeFileSync(path, full.slice(0, Math.floor(full.length / 2)));
    setTimeout(() => writeFileSync(path, full), 15);

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(out).toEqual([
      { t: 'text', delta: 'placing it now' },
      { t: 'tool-start', callId: 'p1-0', name: 'place_object' },
      { t: 'tool-args', callId: 'p1-0', delta: JSON.stringify({ x: 1 }) },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [{ callId: 'p1-0', name: 'place_object', args: { x: 1 }, rawArgs: JSON.stringify({ x: 1 }) }],
      },
    ]);
  });

  it('ends with the network error, never a rejection, when the file stays torn past the timeout', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { timeoutMs: 20, pollMs: 5 });
    const path = join(dir, 'turn-1.response.json');
    writeFileSync(path, '{"text": "unfinishe'); // never completed

    const out = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(out).toEqual([{ t: 'error', error: { cls: 'network', detail: 'played model did not answer' } }]);
  });

  it('numbers two sequential turns 1 and 2', async () => {
    const dir = makeDir();
    const adapter = createPlayedAdapter(dir, { pollMs: 5 });

    respondSoon(dir, 1, { text: 'first' });
    await collect(adapter.stream(baseRequest(), new AbortController().signal));

    respondSoon(dir, 2, { text: 'second' });
    await collect(adapter.stream(baseRequest({ model: 'played-model-2' }), new AbortController().signal));

    const req1 = JSON.parse(readFileSync(join(dir, 'turn-1.request.json'), 'utf8'));
    const req2 = JSON.parse(readFileSync(join(dir, 'turn-2.request.json'), 'utf8'));
    expect(req1.model).toBe('played-model');
    expect(req2.model).toBe('played-model-2');
  });
});
