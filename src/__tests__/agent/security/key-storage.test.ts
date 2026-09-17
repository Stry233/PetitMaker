import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAgentSettings, saveAgentSettings } from '../../../agent/security/key-storage';

// jsdom 25 under this node version exposes a localStorage descriptor that yields
// undefined, so back the global with a Map-based stub (same Storage surface).
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

describe('agent key storage', () => {
  beforeEach(() => backing.clear());

  it('defaults to claude with NO seeded model (a model is only real once a live fetch picks it) and no keys', () => {
    const s = loadAgentSettings();
    expect(s.provider).toBe('claude');
    expect(s.model.claude).toBe('');
    expect(s.keys.claude).toBeUndefined();
  });

  it('round-trips and obfuscates keys (raw key not in storage)', () => {
    const s = loadAgentSettings();
    s.keys.openai = 'sk-test-123';
    s.provider = 'openai';
    saveAgentSettings(s);
    expect([...backing.values()].join()).not.toContain('sk-test-123');
    expect(loadAgentSettings().keys.openai).toBe('sk-test-123');
    expect(loadAgentSettings().provider).toBe('openai');
  });

  it('survives corrupted storage by falling back to defaults', () => {
    backing.set('petit-agent-settings-v1', '{not json');
    expect(loadAgentSettings().provider).toBe('claude');
  });
});

describe('sealed blob a locked vault could not open', () => {
  it('survives a keyless save (the keyring is empty because the vault declined, not because the user cleared it)', async () => {
    // jsdom has no IndexedDB, so `openSecret` declines exactly as it does in a private window or
    // on a profile carried to another machine: hydration finishes with nothing in hand while the
    // ciphertext is still on disk. A settings write must not take that as "cleared".
    // Fresh module instance: `keysHydrated`/`sealedUnread` are module globals with no reset.
    vi.resetModules();
    const { loadAgentSettings, saveAgentSettings, hydrateSealedKeys, markKeysHydrated } =
      await import('../../../agent/security/key-storage');
    backing.clear();
    const blob = { iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZS1jaXBoZXJ0ZXh0' };
    backing.set('petit-agent-settings-v1', JSON.stringify({ provider: 'openai', keysSealed: blob }));

    expect(await hydrateSealedKeys()).toBeNull();
    markKeysHydrated();
    saveAgentSettings({ ...loadAgentSettings(), oversight: 'strict' });

    const rec = JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keysSealed?: unknown };
    expect(rec.keysSealed).toEqual(blob);
  });
});

describe('custom endpoint persistence', () => {
  it('round-trips customBaseUrl (plain, not obfuscated: it is not a secret)', async () => {
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/key-storage');
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, provider: 'custom', customBaseUrl: 'https://genai.example.edu/api' });
    const back = loadAgentSettings();
    expect(back.provider).toBe('custom');
    expect(back.customBaseUrl).toBe('https://genai.example.edu/api');
  });

  it('treats an empty stored customBaseUrl as unset', async () => {
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/key-storage');
    saveAgentSettings({ ...loadAgentSettings(), customBaseUrl: undefined });
    expect(loadAgentSettings().customBaseUrl).toBeUndefined();
  });
});

describe('sealed keys and the obfuscated fallback', () => {
  const SEALED = { iv: 'iv', ct: btoa(JSON.stringify({ openai: 'sk-live-1' })) };

  /** A readable vault: `openSecret` returns what `sealSecret` was given. */
  async function withFakeVault() {
    vi.resetModules();
    vi.doMock('../../../core/runtime/vault', () => ({
      sealSecret: (plain: string) => Promise.resolve({ iv: 'iv', ct: btoa(plain) }),
      openSecret: (blob: { ct: string }) => Promise.resolve(atob(blob.ct)),
      sealWithKey: () => Promise.resolve(null),
      openWithKey: () => Promise.resolve(null),
    }));
    const mod = await import('../../../agent/security/key-storage');
    backing.clear();
    backing.set('petit-agent-settings-v1', JSON.stringify({ provider: 'openai', keysSealed: SEALED }));
    expect(await mod.hydrateSealedKeys()).toEqual({ openai: 'sk-live-1' });
    mod.markKeysHydrated();
    return mod;
  }

  function record(): { keys?: Record<string, string>; keysSealed?: unknown } {
    return JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keys?: Record<string, string>; keysSealed?: unknown };
  }

  it('omits the obfuscated copy when the sealed blob already holds the same keys', async () => {
    const { loadAgentSettings, saveAgentSettings } = await withFakeVault();
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, keys: { openai: 'sk-live-1' }, model: { ...s.model, openai: 'gpt-4.1' } });

    expect(record().keys).toBeUndefined();
    expect(record().keysSealed).toEqual(SEALED);
    expect(backing.get('petit-agent-settings-v1')).not.toContain(btoa('sk-live-1'));
  });

  it('writes the obfuscated copy when the key set changed', async () => {
    const { loadAgentSettings, saveAgentSettings } = await withFakeVault();
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, keys: { openai: 'sk-live-2' } });

    expect(record().keys?.openai).toBeDefined();
  });

  it('writes the obfuscated copy when no sealed blob exists', async () => {
    vi.resetModules();
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/key-storage');
    backing.clear();
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, keys: { openai: 'sk-first' } });

    expect(record().keys?.openai).toBeDefined();
  });
});

describe('a freshly sealed keyring', () => {
  it('stops mirroring the obfuscated copy once the vault upgrade has sealed it', async () => {
    vi.resetModules();
    vi.doMock('../../../core/runtime/vault', () => ({
      sealSecret: (plain: string) => Promise.resolve({ iv: 'iv', ct: btoa(plain) }),
      openSecret: (blob: { ct: string }) => Promise.resolve(atob(blob.ct)),
      sealWithKey: () => Promise.resolve(null),
      openWithKey: () => Promise.resolve(null),
    }));
    const { loadAgentSettings, saveAgentSettings, markKeysHydrated } =
      await import('../../../agent/security/key-storage');
    backing.clear();
    markKeysHydrated();

    const first = loadAgentSettings();
    saveAgentSettings({ ...first, keys: { openai: 'sk-first' } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    saveAgentSettings({ ...first, keys: { openai: 'sk-first' }, oversight: 'strict' });
    const rec = JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keys?: unknown; keysSealed?: unknown };
    expect(rec.keys).toBeUndefined();
    expect(rec.keysSealed).toBeDefined();
  });
});

describe('storage that refuses to write', () => {
  it('reports the failure instead of throwing out of the save', async () => {
    // Safari private mode throws from `setItem`; the save runs inside a React handler.
    vi.resetModules();
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/key-storage');
    backing.clear();
    const s = loadAgentSettings();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    try {
      expect(saveAgentSettings({ ...s, provider: 'openai' })).toBe(false);
    } finally {
      setItem.mockRestore();
    }
    expect(saveAgentSettings({ ...s, provider: 'openai' })).toBe(true);
  });
});
