/**
 * The one model-discovery mechanism behind the assistant's key reading and the stylize connection:
 * a newer probe outdates the one in flight, refusals count, and the settled model follows the list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModelDiscovery, settledModel, type ProbeAnswer } from '../../../platform/async/model-discovery';

afterEach(() => { vi.useRealTimers(); });

/** A probe whose answers the test releases by hand. */
function manual() {
  const calls: { resolve: (a: ProbeAnswer) => void; reject: (e: unknown) => void; signal: AbortSignal; req: string }[] = [];
  const discovery = createModelDiscovery<string>((req, signal) => new Promise((resolve, reject) => { calls.push({ resolve, reject, signal, req }); }));
  return { discovery, calls };
}

describe('model discovery', () => {
  it('drops an outdated answer and aborts its request', async () => {
    const { discovery, calls } = manual();
    discovery.probe('a');
    discovery.probe('b');
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve({ models: ['old'] });
    calls[1]!.resolve({ models: ['new'] });
    await Promise.resolve(); await Promise.resolve();
    expect(discovery.get()).toMatchObject({ state: 'ready', models: ['new'], arrivals: 1 });
  });

  it('waits out the debounce, and a superseded probe never asks', async () => {
    vi.useFakeTimers();
    const { discovery, calls } = manual();
    discovery.probe('a', 600);
    expect(discovery.get().state).toBe('loading');
    discovery.supersede();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toHaveLength(0);
    expect(discovery.get().state).toBe('loading');
    discovery.probe('b', 600);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.map((c) => c.req)).toEqual(['b']);
  });

  it('counts each refusal, settles a failure as unlisted and resets to none', async () => {
    const { discovery, calls } = manual();
    discovery.probe('a');
    calls[0]!.resolve('refused');
    await Promise.resolve(); await Promise.resolve();
    expect(discovery.get()).toMatchObject({ state: 'refused', refusals: 1 });
    discovery.noteRefusal();
    expect(discovery.get().refusals).toBe(2);
    discovery.probe('b');
    calls[1]!.reject(new Error('cors'));
    await Promise.resolve(); await Promise.resolve();
    expect(discovery.get().state).toBe('unlisted');
    discovery.reset();
    expect(discovery.get()).toMatchObject({ state: 'none', models: [] });
  });

  it('keeps the current model while the list offers it, else the first, else the default', () => {
    expect(settledModel('b', { state: 'ready', models: ['a', 'b'] }, 'd')).toBe('b');
    expect(settledModel('x', { state: 'ready', models: ['a', 'b'] }, 'd')).toBe('a');
    expect(settledModel('', { state: 'unlisted', models: [] }, 'd')).toBe('d');
    expect(settledModel('typed', { state: 'unlisted', models: [] }, 'd')).toBe('typed');
    expect(settledModel('', { state: 'loading', models: [] }, 'd')).toBe('');
  });
});
