// @vitest-environment jsdom
/** Pins the panel's shared hooks: the toggle set and the endpoint draft. */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToggleSet } from '../../../../ui/agent/hooks/use-toggle-set';
import { useEndpointDraft } from '../../../../ui/agent/hooks/use-endpoint-draft';

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
