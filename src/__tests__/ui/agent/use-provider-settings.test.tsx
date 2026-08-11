/**
 * useProviderSettings — the setup/chat auto-open timing. Saved keys decrypt
 * asynchronously (keysHydrated flips true when the vault settles). The hook must
 * NOT force the setup screen open from the un-hydrated "no key" state, or a user
 * who has a saved key sees the greeting flash to the model-selection screen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentStore } from '../../../agent/store';
import { useProviderSettings } from '../../../ui/agent/useProviderSettings';

// The probe never identifies a platform here, so detection always "fails".
/** Swapped per test to make listModels() throw (an unreachable endpoint) instead of listing. */
const listModels = { fn: async (): Promise<string[]> => [] };

vi.mock('../../../agent/providers', () => ({
  PROVIDERS: new Proxy(
    {},
    { get: () => ({ create: () => ({ listModels: () => listModels.fn() }), modelFilter: () => true, fallbackModels: [] }) },
  ),
  identifyProviderByProbe: vi.fn(async () => null),
  // A single-host provider resolves to nothing, which is the shape every provider in this file has.
  REGION_SPLIT: new Set<string>(),
  baseUrlFor: () => undefined,
  resolveBaseUrl: vi.fn(async () => undefined),
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

  it('offers no model at all when the endpoint is unreachable', async () => {
    // An unreachable endpoint must leave the dropdown EMPTY rather than showing a model the user
    // cannot actually run: every model offered has to have come from that endpoint saying so.
    // The user types one by hand instead.
    listModels.fn = async () => { throw new Error('CORS / offline'); };
    try {
      setStore(true, { claude: 'sk-ant-x' });
      useAgentStore.setState((s) => ({
        settings: { ...s.settings, model: { ...s.settings.model, claude: 'remembered-model' } },
        modelList: { claude: ['remembered-model'] },
      }));
      const { result } = renderHook(() => useProviderSettings(vi.fn()));
      await act(async () => { await result.current.refreshModels(); });
      const s = useAgentStore.getState();
      expect(s.modelList.claude).toEqual([]);
      expect(s.settings.model.claude).toBe('');
    } finally {
      listModels.fn = async () => [];
    }
  });

  it('never selects a preferred model the live list does not offer', async () => {
    // preferredModel RANKS the live list; it is not a value the app can fall back to. A platform
    // whose preferred id is stale must land on a model the endpoint actually named.
    listModels.fn = async () => ['some-other-model'];
    try {
      setStore(true, { claude: 'sk-ant-x' });
      useAgentStore.setState((s) => ({
        settings: { ...s.settings, model: { ...s.settings.model, claude: '' } },
        modelList: {},
      }));
      const { result } = renderHook(() => useProviderSettings(vi.fn()));
      await act(async () => { await result.current.refreshModels(); });
      expect(useAgentStore.getState().settings.model.claude).toBe('some-other-model');
    } finally {
      listModels.fn = async () => [];
    }
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
