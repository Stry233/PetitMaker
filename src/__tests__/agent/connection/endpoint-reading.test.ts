// @vitest-environment jsdom
/**
 * The endpoint reading runs without React: it lists the armed connection's models once and answers
 * later readings from the session cache, drops a superseded answer, files a typed custom address
 * once typing rests and says what the address answered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEndpointReading } from '../../../agent/connection/endpoint-reading';
import { IDLE_MS } from '../../../agent/connection/key-reading';
import { forgetRosters } from '../../../agent/connection/model-roster';
import { __resetAgentConnection, useAgentConnection } from '../../../agent/connection/store';

const connection = () => useAgentConnection.getState();
const settled = () => vi.advanceTimersByTimeAsync(0);
const stops: (() => void)[] = [];

/** A started reading over `listModels`, stopped as the test ends. */
function reading(listModels: Parameters<typeof createEndpointReading>[0]['listModels'], onFiled?: () => void) {
  const made = createEndpointReading({ listModels, ...(onFiled ? { onFiled } : {}) });
  stops.push(made.start());
  return made;
}

beforeEach(() => {
  localStorage.clear();
  forgetRosters();
  __resetAgentConnection();
  connection().connectKey('openai', 'sk-test-key-for-roster');
  connection().setProvider('openai');
  vi.useFakeTimers();
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

describe('the connection\'s model list', () => {
  it('loads once, answers a later reading from the session cache, and asks again on refresh', async () => {
    const listModels = vi.fn(() => Promise.resolve(['m1', 'm2']));
    const first = reading(listModels);
    expect(first.get().status).toBe('loading');
    await settled();
    expect(first.get()).toMatchObject({ status: 'ready', models: ['m1', 'm2'], allowManual: false });

    const second = reading(listModels);
    expect(second.get().status).toBe('ready');
    expect(listModels).toHaveBeenCalledTimes(1);
    second.refresh();
    await settled();
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('reads an answering server without a list as ready with a model named by hand, and a silent one as failed', async () => {
    const answered = reading(() => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })));
    await settled();
    expect(answered.get()).toMatchObject({ status: 'ready', models: [], allowManual: true, endpointNote: null });

    const silent = reading(() => Promise.reject(new Error('Failed to fetch')));
    await settled();
    expect(silent.get()).toMatchObject({ status: 'failed', endpointNote: 'unavailable' });
  });

  it('drops the answer to a request a newer one superseded, and stops that request', async () => {
    let resolveOld!: (ids: string[]) => void;
    let oldSignal: AbortSignal | undefined;
    const listModels = vi.fn()
      .mockImplementationOnce((_cfg: unknown, signal?: AbortSignal) => {
        oldSignal = signal;
        return new Promise<string[]>((resolve) => { resolveOld = resolve; });
      })
      .mockImplementationOnce(() => Promise.resolve(['fresh']));
    const made = reading(listModels);
    made.refresh();
    await settled();
    expect(oldSignal?.aborted).toBe(true);
    resolveOld(['stale']);
    await settled();
    expect(made.get().models).toEqual(['fresh']);
  });

  it('stands idle without a connection, and asks once a key arrives', async () => {
    connection().forgetKey('openai');
    const listModels = vi.fn(() => Promise.resolve(['m']));
    const made = reading(listModels);
    expect(made.get().status).toBe('idle');
    expect(listModels).not.toHaveBeenCalled();
    connection().connectKey('openai', 'sk-another-test-key');
    await settled();
    expect(made.get()).toMatchObject({ status: 'ready', models: ['m'] });
  });

  it('touches nothing once stopped, whatever answers late', async () => {
    let resolve!: (ids: string[]) => void;
    const made = createEndpointReading({ listModels: () => new Promise<string[]>((done) => { resolve = done; }) });
    const stop = made.start();
    stop();
    resolve(['late']);
    await settled();
    expect(made.get().models).toEqual([]);
  });
});

describe('a custom endpoint\'s address', () => {
  beforeEach(() => {
    connection().connectKey('custom', 'local-key');
    connection().setProvider('custom');
  });

  it('offers no model before an address is filed', () => {
    const made = reading(() => Promise.resolve(['m']));
    expect(made.get()).toMatchObject({ needsEndpoint: true, models: [], allowManual: false, draft: '' });
  });

  it('files a typed address once typing rests, asks it what it runs, and tells the card', async () => {
    const listModels = vi.fn(() => Promise.resolve(['local-model']));
    const onFiled = vi.fn();
    const made = reading(listModels, onFiled);
    made.edit('http://localhost:11434/v');
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    made.edit('http://localhost:11434/v1');
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(connection().customBaseUrl, 'each keystroke restarts the quiet').toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(connection().customBaseUrl).toBe('http://localhost:11434/v1');
    expect(onFiled).toHaveBeenCalledTimes(1);
    await settled();
    expect(made.get()).toMatchObject({ needsEndpoint: false, bad: false, models: ['local-model'], allowManual: true });
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'custom', customBaseUrl: 'http://localhost:11434/v1' }), expect.any(AbortSignal));
  });

  it('refuses an unusable address in place, once, and files nothing', async () => {
    const listModels = vi.fn(() => Promise.resolve(['m']));
    const made = reading(listModels);
    const asked = listModels.mock.calls.length;
    made.edit('not an address');
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(made.get()).toMatchObject({ bad: true, endpointNote: 'invalid', draft: 'not an address' });
    expect(connection().customBaseUrl).toBe('');
    expect(listModels).toHaveBeenCalledTimes(asked);
    made.edit('not an address either');
    expect(made.get().bad, 'typing clears the refusal').toBe(false);
  });

  it('checks at once on confirm, and asks the same address again', async () => {
    const listModels = vi.fn(() => Promise.resolve(['m']));
    const made = reading(listModels);
    const asked = listModels.mock.calls.length;
    made.edit('http://localhost:11434/v1');
    made.confirm();
    await settled();
    expect(connection().customBaseUrl).toBe('http://localhost:11434/v1');
    expect(listModels).toHaveBeenCalledTimes(asked + 1);
    made.edit('http://localhost:11434/v1');
    made.confirm();
    await settled();
    expect(listModels, 'the same address is asked again on purpose').toHaveBeenCalledTimes(asked + 2);
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(listModels, 'a filed draft arms no later check').toHaveBeenCalledTimes(asked + 2);
  });
});
