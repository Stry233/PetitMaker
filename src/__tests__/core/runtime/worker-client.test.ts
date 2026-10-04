import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerClient, WorkerFailure } from '../../../core/runtime/worker-client';

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: unknown[][] = [];
  terminate = vi.fn();
  postMessage(...args: unknown[]) { this.posted.push(args); }
  reply(data: unknown) { this.onmessage?.({ data }); }
}

let spawned: FakeWorker[] = [];
const spawn = () => { const w = new FakeWorker(); spawned.push(w); return w as unknown as Worker; };

beforeEach(() => { vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { spawned = []; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('createWorkerClient', () => {
  it('posts the message as given, answers with the first reply and retires a one-shot worker', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0 });
    const answer = client.request<string>({ message: { a: 1 } });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.posted).toEqual([[{ a: 1 }]]);
    spawned[0]!.reply('done');
    await expect(answer).resolves.toBe('done');
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('passes the transfer list and skips the messages its reader declines', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0 });
    const buffer = new ArrayBuffer(4);
    const seen: unknown[] = [];
    const answer = client.request<number>({
      message: 'go', transfer: [buffer],
      read: (data) => { seen.push(data); return (data as { result?: number }).result; },
    });
    expect(spawned[0]!.posted).toEqual([['go', [buffer]]]);
    spawned[0]!.reply({ progress: 1 });
    spawned[0]!.reply({ result: 7 });
    await expect(answer).resolves.toBe(7);
    expect(seen).toEqual([{ progress: 1 }, { result: 7 }]);
  });

  it('keeps an idle worker for idleMs, and while holdOpen says so', async () => {
    vi.useFakeTimers();
    let hold = true;
    const client = createWorkerClient({ spawn, idleMs: 1000, holdOpen: () => hold });
    const answer = client.request({ message: 1 });
    spawned[0]!.reply('ok');
    await answer;
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawned[0]!.terminate).not.toHaveBeenCalled();
    hold = false;
    client.settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(spawned[0]!.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
    void client.request({ message: 2 });
    expect(spawned).toHaveLength(2);
  });

  it('matches keyed replies by id with several in flight', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0, keyed: true });
    const first = client.request({ message: { n: 'a' } });
    const second = client.request({ message: { n: 'b' } });
    expect(spawned).toHaveLength(1);
    const [[a], [b]] = spawned[0]!.posted as [[{ id: number; n: string }], [{ id: number; n: string }]];
    expect([a.n, b.n]).toEqual(['a', 'b']);
    spawned[0]!.reply({ id: b.id, v: 2 });
    spawned[0]!.reply({ id: a.id, v: 1 });
    await expect(first).resolves.toEqual({ id: a.id, v: 1 });
    await expect(second).resolves.toEqual({ id: b.id, v: 2 });
  });

  it('fails everything pending on a crash and respawns on the next request', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0, keyed: true });
    const one = client.request({ message: {} });
    const two = client.request({ message: {} });
    spawned[0]!.onerror?.();
    await expect(one).rejects.toMatchObject({ kind: 'crash', heard: false });
    await expect(two).rejects.toBeInstanceOf(WorkerFailure);
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
    void client.request({ message: {} }).catch(() => {});
    expect(spawned).toHaveLength(2);
  });

  it('reports whether the worker had spoken before it broke', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0 });
    const answer = client.request({ message: 1, read: (d) => ((d as { done?: boolean }).done ? d : undefined) });
    spawned[0]!.reply({ progress: true });
    spawned[0]!.onmessageerror?.();
    await expect(answer).rejects.toMatchObject({ kind: 'unreadable', heard: true });
  });

  it('times out, terminating the worker', async () => {
    vi.useFakeTimers();
    const client = createWorkerClient({ spawn, idleMs: 0 });
    const answer = client.request({ message: 1, timeoutMs: 500 });
    const outcome = expect(answer).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(500);
    await outcome;
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    // The retired worker's late answer and error reach nothing.
    spawned[0]!.reply('late');
    spawned[0]!.onerror?.();
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('cancels through the signal without consulting the fallback', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0 });
    const controller = new AbortController();
    const fallback = vi.fn(() => 'fallback');
    const answer = client.request({ message: 1, signal: controller.signal, fallback });
    controller.abort();
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
    expect(fallback).not.toHaveBeenCalled();
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
    await expect(client.request({ message: 1, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(spawned).toHaveLength(1);
  });

  it('refuses a second request to a one-at-a-time worker as busy', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0 });
    void client.request({ message: 1 });
    expect(client.busy).toBe(true);
    await expect(client.request({ message: 2 })).rejects.toMatchObject({ kind: 'busy' });
  });

  it('answers through the fallback where there is no worker, or it cannot be built', async () => {
    vi.stubGlobal('Worker', undefined);
    const client = createWorkerClient({ spawn, idleMs: 0 });
    await expect(client.request({ message: 1, fallback: (f) => f.kind })).resolves.toBe('unsupported');
    vi.stubGlobal('Worker', FakeWorker);
    const broken = createWorkerClient({ spawn: () => { throw new Error('csp'); }, idleMs: 0 });
    await expect(broken.request({ message: 1, fallback: (f) => f.kind })).resolves.toBe('spawn');
    await expect(broken.request({ message: 1 })).rejects.toMatchObject({ kind: 'spawn' });
  });

  it('fails the request whose post throws', async () => {
    const client = createWorkerClient({
      spawn: () => { const w = spawn() as unknown as FakeWorker; w.postMessage = () => { throw new Error('clone'); }; return w as unknown as Worker; },
      idleMs: 0,
    });
    await expect(client.request({ message: 1 })).rejects.toMatchObject({ kind: 'post' });
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('fails only the keyed request whose post throws, keeping the worker for the rest', async () => {
    let throwNext = false;
    const client = createWorkerClient({
      spawn: () => {
        const w = spawn() as unknown as FakeWorker;
        const post = w.postMessage.bind(w);
        w.postMessage = (...args: unknown[]) => { if (throwNext) { throwNext = false; throw new Error('clone'); } post(...args); };
        return w as unknown as Worker;
      },
      idleMs: 0, keyed: true,
    });
    const first = client.request({ message: {} });
    throwNext = true;
    await expect(client.request({ message: {} })).rejects.toMatchObject({ kind: 'post' });
    expect(spawned[0]!.terminate).not.toHaveBeenCalled();
    const [[a]] = spawned[0]!.posted as [[{ id: number }]];
    spawned[0]!.reply({ id: a.id });
    await expect(first).resolves.toEqual({ id: a.id });
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('fails the request whose reply its reader throws on, and settles', async () => {
    const client = createWorkerClient({ spawn, idleMs: 0 });
    const answer = client.request({ message: 1, read: () => { throw new Error('bad shape'); } });
    spawned[0]!.reply({});
    await expect(answer).rejects.toMatchObject({ kind: 'unreadable', heard: true });
    expect(spawned[0]!.terminate).toHaveBeenCalledOnce();
    expect(client.busy).toBe(false);
  });

  it('sends the client id over any id the message carries', () => {
    const client = createWorkerClient({ spawn, idleMs: 0, keyed: true });
    void client.request({ message: { id: 'theirs', n: 1 } });
    const [[sent]] = spawned[0]!.posted as [[{ id: unknown; n: number }]];
    expect(typeof sent.id).toBe('number');
    expect(sent.n).toBe(1);
  });
});
