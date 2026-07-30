/**
 * useProviderSettings — the setup/chat auto-open timing. Saved keys decrypt
 * asynchronously (keysHydrated flips true when the vault settles). The hook must
 * NOT force the setup screen open from the un-hydrated "no key" state, or a user
 * who has a saved key sees the greeting flash to the model-selection screen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentStore } from '../../../agent/store';
import { useProviderSettings } from '../../../ui/menu/agent/useProviderSettings';

// The probe never identifies a platform here, so detection always "fails".
vi.mock('../../../agent/providers', () => ({
  PROVIDERS: new Proxy(
    {},
    { get: () => ({ create: () => ({ listModels: async () => [] }), modelFilter: () => true, fallbackModels: [] }) },
  ),
  identifyProviderByProbe: vi.fn(async () => null),
}));

const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

function setStore(keysHydrated: boolean, keys: Record<string, string>) {
  useAgentStore.setState((s) => ({
    keysHydrated,
    settings: { ...s.settings, provider: 'claude', keys, customBaseUrl: undefined },
  }));
}

describe('useProviderSettings — setup-open timing', () => {
  beforeEach(() => {
    backing.clear();
    setStore(false, {});
  });

  it('does NOT force settings open before keys hydrate (prevents the no-key → model-selection flash)', () => {
    setStore(false, {});
    const setOpen = vi.fn();
    renderHook(() => useProviderSettings(setOpen));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it('does NOT open settings once hydrated when a key already exists', () => {
    setStore(true, { claude: 'sk-ant-existing' });
    const setOpen = vi.fn();
    renderHook(() => useProviderSettings(setOpen));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it('opens settings once hydrated when the provider has no key', () => {
    setStore(true, {});
    const setOpen = vi.fn();
    renderHook(() => useProviderSettings(setOpen));
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it('refreshModels clears a stale selected model when the live list comes back empty', async () => {
    setStore(true, { claude: 'sk-ant-x' });
    useAgentStore.setState((s) => ({
      settings: { ...s.settings, model: { ...s.settings.model, claude: 'old-model' } },
      modelList: { claude: ['old-model'] },
    }));
    const { result } = renderHook(() => useProviderSettings(vi.fn()));
    await act(async () => { await result.current.refreshModels(); });
    const s = useAgentStore.getState();
    expect(s.modelList.claude).toEqual([]);       // no fetched models
    expect(s.settings.model.claude).toBe('');     // stale selection dropped
  });

  it('saveKey falls back to Custom when the platform cannot be identified (no auto-chooser)', async () => {
    setStore(true, {});
    const { result } = renderHook(() => useProviderSettings(vi.fn()));
    await act(async () => { await result.current.saveKey(true, 'xyz-unrecognized-key-123'); });
    const s = useAgentStore.getState();
    expect(s.settings.provider).toBe('custom');
    expect(s.settings.keys.custom).toBe('xyz-unrecognized-key-123');
  });
});
