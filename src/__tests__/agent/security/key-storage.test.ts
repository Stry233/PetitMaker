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
