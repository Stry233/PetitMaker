// @vitest-environment jsdom
/** Pins the panel's shared hooks: the toggle set, the endpoint draft and the model roster. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToggleSet } from '../../../../ui/agent/hooks/use-toggle-set';
import { useEndpointDraft } from '../../../../ui/agent/hooks/use-endpoint-draft';
import { useModelRoster } from '../../../../ui/agent/hooks/use-model-roster';
import { forgetRosters } from '../../../../agent/connection/model-roster';

describe('useToggleSet', () => {
  it('opens and closes keys independently', () => {
    const { result } = renderHook(() => useToggleSet<number>());
    act(() => { result.current.toggle(1); result.current.toggle(2); });
    expect([result.current.has(1), result.current.has(2)]).toEqual([true, true]);
    act(() => { result.current.toggle(1); });
    expect([result.current.has(1), result.current.has(2)]).toEqual([false, true]);
  });
});

describe('useEndpointDraft', () => {
  it('follows the stored address until the user types, and again once settled', () => {
    const { result, rerender } = renderHook(({ stored }) => useEndpointDraft(stored), { initialProps: { stored: 'https://a.example/v1' } });
    expect(result.current.value).toBe('https://a.example/v1');
    rerender({ stored: 'https://b.example/v1' });
    expect(result.current.value, 'a stored change reaches an untouched field').toBe('https://b.example/v1');
    act(() => { result.current.edit('https://typed'); });
    rerender({ stored: 'https://c.example/v1' });
    expect(result.current.value, 'a draft is never overwritten').toBe('https://typed');
    act(() => { result.current.refuse(); });
    expect(result.current.bad).toBe(true);
    act(() => { result.current.settle(); });
    expect([result.current.value, result.current.bad]).toEqual(['https://c.example/v1', false]);
  });
});

describe('useModelRoster', () => {
  beforeEach(() => { forgetRosters(); });

  const props = { provider: 'openai' as const, customBaseUrl: '', apiKey: 'k', region: undefined, connected: true };

  it('loads once, answers later mounts from the session cache, and asks again on refresh', async () => {
    const listModels = vi.fn(() => Promise.resolve(['m1', 'm2']));
    const first = renderHook(() => useModelRoster({ ...props, listModels }));
    expect(first.result.current.status).toBe('loading');
    await act(async () => {});
    expect(first.result.current).toMatchObject({ status: 'ready', models: ['m1', 'm2'] });
    first.unmount();

    const second = renderHook(() => useModelRoster({ ...props, listModels }));
    expect(second.result.current.status).toBe('ready');
    expect(listModels).toHaveBeenCalledTimes(1);
    await act(async () => { second.result.current.refresh(); });
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('reads an answering server without a list as ready, and an unreachable one as failed', async () => {
    const answered = renderHook(() => useModelRoster({
      ...props, listModels: () => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })),
    }));
    await act(async () => {});
    expect(answered.result.current).toMatchObject({ status: 'ready', models: [] });

    const silent = renderHook(() => useModelRoster({ ...props, listModels: () => Promise.reject(new Error('Failed to fetch')) }));
    await act(async () => {});
    expect(silent.result.current.status).toBe('failed');
  });

  it('drops the answer to a request a newer one superseded', async () => {
    let resolveOld!: (ids: string[]) => void;
    const listModels = vi.fn()
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => Promise.resolve(['fresh']));
    const { result } = renderHook(() => useModelRoster({ ...props, listModels }));
    await act(async () => { result.current.refresh(); });
    await act(async () => { resolveOld(['stale']); });
    expect(result.current.models).toEqual(['fresh']);
  });

  it('stands idle without a connection', () => {
    const listModels = vi.fn(() => Promise.resolve(['m']));
    const { result } = renderHook(() => useModelRoster({ ...props, connected: false, listModels }));
    expect(result.current.status).toBe('idle');
    expect(listModels).not.toHaveBeenCalled();
  });
});
