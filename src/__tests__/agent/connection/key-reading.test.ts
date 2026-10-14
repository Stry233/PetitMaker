// @vitest-environment jsdom
/**
 * The key reading runs without React: the idle advance files the key, a settled check hands off to
 * management, a refusal returns to the key and shakes it, and an edit outdates a check in flight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyReading, IDLE_MS } from '../../../agent/connection/key-reading';
import { forgetRosters } from '../../../agent/connection/model-roster';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS } from '../../../agent/providers/defaults';

const KEY = 'sk-ant-api03-abcdefghijkl';
const unauthorized = () => Object.assign(new Error('Unauthorized'), { status: 401 });

beforeEach(async () => {
  localStorage.clear();
  forgetRosters();
  for (const id of PROVIDER_IDS) useAgentConnection.getState().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
  await useAgentConnection.getState().hydrate();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

/** A listing the test answers by hand. */
function held() {
  const answers: { resolve: (ids: string[]) => void; reject: (e: unknown) => void }[] = [];
  const listModels = vi.fn(() => new Promise<string[]>((resolve, reject) => { answers.push({ resolve, reject }); }));
  return { listModels, answers };
}

describe('the key reading', () => {
  it('files a usable key once typing rests, then hands off to management', async () => {
    const { listModels, answers } = held();
    const onManage = vi.fn();
    const reading = createKeyReading({ entry: 'key', listModels, onManage, pictured: false });
    const stop = reading.start();
    reading.editKey(KEY);
    expect(reading.get()).toMatchObject({ phase: 'key', shape: 'claude', gate: 'commit' });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(reading.get().phase).toBe('checking');
    answers[0]!.resolve(['claude-opus']);
    await vi.advanceTimersByTimeAsync(0);
    expect(reading.get().phase).toBe('manage');
    expect(onManage).toHaveBeenCalledTimes(1);
    stop();
  });

  it('returns a refused key to the field and counts the refusal', async () => {
    const { listModels, answers } = held();
    const reading = createKeyReading({ entry: 'key', listModels, pictured: false });
    const stop = reading.start();
    reading.editKey(KEY);
    reading.confirmNow();
    answers[0]!.reject(unauthorized());
    await vi.advanceTimersByTimeAsync(0);
    expect(reading.get()).toMatchObject({ phase: 'key', refused: true, shakeSeq: 1 });
    stop();
  });

  it('lets an edit outdate the check in flight', async () => {
    const { listModels, answers } = held();
    const reading = createKeyReading({ entry: 'key', listModels, pictured: false });
    const stop = reading.start();
    reading.editKey(KEY);
    reading.confirmNow();
    reading.editKey(`${KEY}x`);
    answers[0]!.reject(unauthorized());
    await vi.advanceTimersByTimeAsync(0);
    expect(reading.get()).toMatchObject({ phase: 'key', refused: false, shakeSeq: 0 });
    stop();
  });

  it('starts no timer in a pictured screen', async () => {
    const { listModels } = held();
    const reading = createKeyReading({ entry: 'key', listModels, pictured: true });
    const stop = reading.start();
    reading.editKey(KEY);
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(listModels).not.toHaveBeenCalled();
    stop();
  });
});
